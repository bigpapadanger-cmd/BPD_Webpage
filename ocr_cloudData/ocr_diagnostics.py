import json
import os
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path

from ocr_config import (
    DEBUG_LEVELS,
    OCR_CPU_LIMIT,
    OCR_DEBUG_LEVEL,
    OCR_MEMORY_LIMIT_MB,
    OCR_METRICS_INTERVAL_SECONDS,
    PADDLE_CPU_THREADS,
    PADDLE_ENABLE_MKLDNN,
    debug_enabled
)

try:
    import psutil
except ImportError:
    psutil = None

DIAGNOSTICS_VERSION = "diagnostics-v2.1-central-debug-level"


def _env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return bool(default)
    return value.strip().lower() in {
        "1",
        "true",
        "yes",
        "on"
    }


def get_debug_level():
    return DEBUG_LEVELS.get(
        OCR_DEBUG_LEVEL,
        DEBUG_LEVELS["summary"]
    )


def atomic_write_json(path, payload, indent=2):
    path = Path(path)
    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )
    temporary_path = path.with_name(
        f".{path.name}.{os.getpid()}.tmp"
    )
    temporary_path.write_text(
        json.dumps(
            payload,
            indent=indent,
            ensure_ascii=False,
            default=str
        ),
        encoding="utf-8"
    )
    os.replace(
        temporary_path,
        path
    )


def _round(value, digits=3):
    if value is None:
        return None
    return round(
        float(value),
        digits
    )


class _GpuSampler:
    def __init__(self):
        self.available = False
        self.error = "gpu_inference_disabled_cpu_only"

    def sample(self, process_id):
        return None

    def close(self):
        return None


class OcrRunProfiler:
    def __init__(self, sample_interval=None):
        configured_interval = (
            OCR_METRICS_INTERVAL_SECONDS
            if sample_interval is None
            else sample_interval
        )
        try:
            configured_interval = float(
                configured_interval
            )
        except (TypeError, ValueError):
            configured_interval = 0.25
        self.sample_interval = min(
            2.0,
            max(0.1, configured_interval)
        )
        self.process_id = os.getpid()
        self.logical_cpu_count = max(
            1,
            os.cpu_count() or 1
        )
        self.configured_cpu_limit = max(
            0.1,
            float(OCR_CPU_LIMIT)
        )
        self.configured_memory_limit_mb = max(
            1.0,
            float(OCR_MEMORY_LIMIT_MB)
        )
        self.process = (
            psutil.Process(self.process_id)
            if psutil
            else None
        )
        self.gpu = _GpuSampler()
        self.started_at = None
        self.started_process_cpu = None
        self.started_root_cpu_seconds = None
        self.current_stage = "initializing"
        self.stage_started_at = None
        self.stage_durations = defaultdict(float)
        self.stage_samples = defaultdict(list)
        self.counters = defaultdict(int)
        self.events = []
        self.samples = []
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._fallback_sample_wall = None
        self._fallback_sample_cpu = None
        self._primed_pids = set()
        self._child_cpu_seconds = {}

    @staticmethod
    def _cpu_seconds(process):
        try:
            times = process.cpu_times()
            return float(
                times.user
                + times.system
            )
        except Exception:
            return None

    def _process_tree(self):
        if self.process is None:
            return []
        processes = [
            self.process
        ]
        try:
            processes.extend(
                self.process.children(
                    recursive=True
                )
            )
        except Exception:
            pass
        unique = {}
        for process in processes:
            try:
                unique[int(process.pid)] = process
            except Exception:
                continue
        return list(
            unique.values()
        )

    def _prime_cpu_percent(self, process):
        try:
            pid = int(process.pid)
        except Exception:
            return False
        if pid in self._primed_pids:
            return True
        try:
            process.cpu_percent(
                interval=None
            )
            self._primed_pids.add(pid)
            return False
        except Exception:
            return False

    def start(self):
        self.started_at = time.perf_counter()
        self.started_process_cpu = time.process_time()
        self._fallback_sample_wall = self.started_at
        self._fallback_sample_cpu = self.started_process_cpu
        self.stage_started_at = self.started_at
        if self.process is not None:
            try:
                self._prime_cpu_percent(
                    self.process
                )
                self.started_root_cpu_seconds = self._cpu_seconds(
                    self.process
                )
                psutil.cpu_percent(
                    interval=None
                )
            except Exception:
                self.process = None
        self._thread = threading.Thread(
            target=self._sample_loop,
            name="ocr-metrics",
            daemon=True
        )
        self._thread.start()
        return self

    def mark_stage(self, stage):
        stage = str(
            stage or "unknown"
        ).strip() or "unknown"
        now = time.perf_counter()
        with self._lock:
            if stage == self.current_stage:
                return
            self.stage_durations[
                self.current_stage
            ] += (
                now
                - self.stage_started_at
            )
            self.current_stage = stage
            self.stage_started_at = now

    @contextmanager
    def stage(self, stage):
        previous_stage = self.current_stage
        self.mark_stage(stage)
        try:
            yield
        finally:
            self.mark_stage(
                previous_stage
            )

    def increment(self, name, amount=1):
        with self._lock:
            self.counters[
                str(name)
            ] += int(amount)

    def event(self, name, **details):
        with self._lock:
            self.events.append({
                "seconds": _round(
                    time.perf_counter()
                    - self.started_at,
                    4
                ),
                "name": str(name),
                "details": details
            })

    def _sample_loop(self):
        while not self._stop_event.wait(
            self.sample_interval
        ):
            sample = self._take_sample()
            if sample is None:
                continue
            with self._lock:
                sample[
                    "stage"
                ] = self.current_stage
                self.samples.append(
                    sample
                )
                self.stage_samples[
                    self.current_stage
                ].append(
                    sample
                )

    def _take_sample(self):
        sample = {
            "seconds": _round(
                time.perf_counter()
                - self.started_at,
                4
            ),
            "cpuPercent": None,
            "cpuLogicalNormalizedPercent": None,
            "cpuAllocatedPercent": None,
            "rssMb": None,
            "rootRssMb": None,
            "childRssMb": None,
            "memoryLimitPercent": None,
            "processCount": None,
            "systemCpuPercent": None,
            "gpu": self.gpu.sample(
                self.process_id
            )
        }
        if self.process is not None:
            try:
                tree = self._process_tree()
                tree_cpu_percent = 0.0
                root_rss = 0
                child_rss = 0
                live_process_count = 0
                for process in tree:
                    try:
                        pid = int(process.pid)
                        is_primed = self._prime_cpu_percent(
                            process
                        )
                        cpu_percent = (
                            float(
                                process.cpu_percent(
                                    interval=None
                                )
                            )
                            if is_primed
                            else 0.0
                        )
                        tree_cpu_percent += max(
                            0.0,
                            cpu_percent
                        )
                        rss = int(
                            process.memory_info().rss
                        )
                        if pid == self.process_id:
                            root_rss += rss
                        else:
                            child_rss += rss
                            cpu_seconds = self._cpu_seconds(
                                process
                            )
                            if cpu_seconds is not None:
                                self._child_cpu_seconds[
                                    pid
                                ] = max(
                                    self._child_cpu_seconds.get(
                                        pid,
                                        0.0
                                    ),
                                    cpu_seconds
                                )
                        live_process_count += 1
                    except Exception:
                        continue
                tree_rss = root_rss + child_rss
                sample["cpuPercent"] = tree_cpu_percent
                sample["cpuLogicalNormalizedPercent"] = (
                    tree_cpu_percent
                    / self.logical_cpu_count
                )
                sample["cpuAllocatedPercent"] = (
                    tree_cpu_percent
                    / self.configured_cpu_limit
                )
                sample["rssMb"] = (
                    tree_rss
                    / (1024 * 1024)
                )
                sample["rootRssMb"] = (
                    root_rss
                    / (1024 * 1024)
                )
                sample["childRssMb"] = (
                    child_rss
                    / (1024 * 1024)
                )
                sample["memoryLimitPercent"] = (
                    sample["rssMb"]
                    / self.configured_memory_limit_mb
                    * 100.0
                )
                sample["processCount"] = live_process_count
                sample["systemCpuPercent"] = float(
                    psutil.cpu_percent(
                        interval=None
                    )
                )
            except Exception:
                self.process = None
        if sample["cpuPercent"] is None:
            sample_wall = time.perf_counter()
            sample_cpu = time.process_time()
            elapsed_wall = (
                sample_wall
                - self._fallback_sample_wall
            )
            elapsed_cpu = (
                sample_cpu
                - self._fallback_sample_cpu
            )
            if elapsed_wall > 0:
                process_cpu = max(
                    0.0,
                    elapsed_cpu
                    / elapsed_wall
                    * 100.0
                )
                sample["cpuPercent"] = process_cpu
                sample["cpuLogicalNormalizedPercent"] = (
                    process_cpu
                    / self.logical_cpu_count
                )
                sample["cpuAllocatedPercent"] = (
                    process_cpu
                    / self.configured_cpu_limit
                )
            self._fallback_sample_wall = sample_wall
            self._fallback_sample_cpu = sample_cpu
        return sample

    @staticmethod
    def _summarize_samples(samples):
        def values(key):
            return [
                sample[key]
                for sample in samples
                if sample.get(key) is not None
            ]

        cpu = values("cpuPercent")
        cpu_logical = values(
            "cpuLogicalNormalizedPercent"
        )
        cpu_allocated = values(
            "cpuAllocatedPercent"
        )
        rss = values("rssMb")
        root_rss = values("rootRssMb")
        child_rss = values("childRssMb")
        memory_limit = values(
            "memoryLimitPercent"
        )
        process_counts = values(
            "processCount"
        )
        system_cpu = values(
            "systemCpuPercent"
        )
        gpu_utilization = []
        gpu_memory = []
        process_gpu_memory = []
        for sample in samples:
            for device in sample.get("gpu") or []:
                gpu_utilization.append(
                    device["utilizationPercent"]
                )
                gpu_memory.append(
                    device["memoryUsedMb"]
                )
                process_gpu_memory.append(
                    device["processMemoryMb"]
                )
        return {
            "samples": len(samples),
            "cpu": {
                "averagePercent": _round(
                    sum(cpu) / len(cpu)
                ) if cpu else None,
                "peakPercent": _round(
                    max(cpu)
                ) if cpu else None,
                "averageLogicalNormalizedPercent": _round(
                    sum(cpu_logical) / len(cpu_logical)
                ) if cpu_logical else None,
                "peakLogicalNormalizedPercent": _round(
                    max(cpu_logical)
                ) if cpu_logical else None,
                "averageAllocatedPercent": _round(
                    sum(cpu_allocated) / len(cpu_allocated)
                ) if cpu_allocated else None,
                "peakAllocatedPercent": _round(
                    max(cpu_allocated)
                ) if cpu_allocated else None,
                "systemAveragePercent": _round(
                    sum(system_cpu) / len(system_cpu)
                ) if system_cpu else None
            },
            "memory": {
                "averageRssMb": _round(
                    sum(rss) / len(rss)
                ) if rss else None,
                "peakRssMb": _round(
                    max(rss)
                ) if rss else None,
                "averageRootRssMb": _round(
                    sum(root_rss) / len(root_rss)
                ) if root_rss else None,
                "peakRootRssMb": _round(
                    max(root_rss)
                ) if root_rss else None,
                "averageChildRssMb": _round(
                    sum(child_rss) / len(child_rss)
                ) if child_rss else None,
                "peakChildRssMb": _round(
                    max(child_rss)
                ) if child_rss else None,
                "averageLimitPercent": _round(
                    sum(memory_limit) / len(memory_limit)
                ) if memory_limit else None,
                "peakLimitPercent": _round(
                    max(memory_limit)
                ) if memory_limit else None
            },
            "processTree": {
                "averageProcessCount": _round(
                    sum(process_counts) / len(process_counts)
                ) if process_counts else None,
                "peakProcessCount": int(
                    max(process_counts)
                ) if process_counts else None
            },
            "gpu": {
                "averageUtilizationPercent": _round(
                    sum(gpu_utilization) / len(gpu_utilization)
                ) if gpu_utilization else None,
                "peakUtilizationPercent": _round(
                    max(gpu_utilization)
                ) if gpu_utilization else None,
                "peakMemoryUsedMb": _round(
                    max(gpu_memory)
                ) if gpu_memory else None,
                "peakProcessMemoryMb": _round(
                    max(process_gpu_memory)
                ) if process_gpu_memory else None
            }
        }

    def finish(self):
        now = time.perf_counter()
        with self._lock:
            self.stage_durations[
                self.current_stage
            ] += (
                now
                - self.stage_started_at
            )
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(
                timeout=max(
                    1.0,
                    self.sample_interval * 2
                )
            )
        final_sample = self._take_sample()
        if final_sample is not None:
            final_sample[
                "stage"
            ] = self.current_stage
            self.samples.append(
                final_sample
            )
            self.stage_samples[
                self.current_stage
            ].append(
                final_sample
            )
        wall_seconds = max(
            0.0,
            now - self.started_at
        )
        root_cpu_seconds = max(
            0.0,
            time.process_time()
            - self.started_process_cpu
        )
        if (
            self.process is not None
            and self.started_root_cpu_seconds is not None
        ):
            ended_root_cpu = self._cpu_seconds(
                self.process
            )
            if ended_root_cpu is not None:
                root_cpu_seconds = max(
                    0.0,
                    ended_root_cpu
                    - self.started_root_cpu_seconds
                )
        child_cpu_seconds = sum(
            max(0.0, value)
            for value in self._child_cpu_seconds.values()
        )
        process_tree_cpu_seconds = (
            root_cpu_seconds
            + child_cpu_seconds
        )
        stage_resources = {}
        for stage, duration in self.stage_durations.items():
            stage_resources[stage] = {
                "seconds": _round(
                    duration,
                    4
                ),
                **self._summarize_samples(
                    self.stage_samples.get(
                        stage,
                        []
                    )
                )
            }
        summary = {
            "version": DIAGNOSTICS_VERSION,
            "wallSeconds": _round(
                wall_seconds,
                4
            ),
            "rootProcessCpuSeconds": _round(
                root_cpu_seconds,
                4
            ),
            "childProcessCpuSeconds": _round(
                child_cpu_seconds,
                4
            ),
            "processTreeCpuSeconds": _round(
                process_tree_cpu_seconds,
                4
            ),
            "processCpuSeconds": _round(
                process_tree_cpu_seconds,
                4
            ),
            "averageCpuCoresUsed": _round(
                process_tree_cpu_seconds
                / wall_seconds,
                3
            ) if wall_seconds > 0 else None,
            "logicalCpuCount": self.logical_cpu_count,
            "configuredCpuLimit": self.configured_cpu_limit,
            "configuredMemoryLimitMb": self.configured_memory_limit_mb,
            "resourceMonitoring": {
                "cpuAvailable": True,
                "memoryAvailable": psutil is not None,
                "gpuAvailable": self.gpu.available,
                "gpuUnavailableReason": self.gpu.error,
                "sampleIntervalSeconds": self.sample_interval,
                "processTreeIncluded": psutil is not None
            },
            "overall": self._summarize_samples(
                self.samples
            ),
            "stages": stage_resources,
            "counters": dict(
                sorted(
                    self.counters.items()
                )
            ),
            "events": list(
                self.events
            )
        }
        if debug_enabled("full"):
            summary["samples"] = list(
                self.samples
            )
        self.gpu.close()
        return summary


_ACTIVE_PROFILER = threading.local()


def get_active_profiler():
    return getattr(
        _ACTIVE_PROFILER,
        "value",
        None
    )


@contextmanager
def profile_ocr_run():
    profiler = OcrRunProfiler().start()
    _ACTIVE_PROFILER.value = profiler
    try:
        yield profiler
    finally:
        _ACTIVE_PROFILER.value = None


def mark_stage(stage):
    profiler = get_active_profiler()
    if profiler is not None:
        profiler.mark_stage(stage)


def increment_counter(name, amount=1):
    profiler = get_active_profiler()
    if profiler is not None:
        profiler.increment(
            name,
            amount
        )


def build_run_report(result, diagnostics):
    result = (
        result
        if isinstance(result, dict)
        else {}
    )
    validation = (
        result.get("validation")
        if isinstance(
            result.get("validation"),
            dict
        )
        else {}
    )
    review = (
        validation.get("two_check_review")
        if isinstance(
            validation.get("two_check_review"),
            dict
        )
        else {}
    )
    matching = (
        validation.get("name_matching_check")
        if isinstance(
            validation.get("name_matching_check"),
            dict
        )
        else {}
    )
    performance = (
        result.get("performance")
        if isinstance(
            result.get("performance"),
            dict
        )
        else {}
    )
    timing_summary = {
        key: value
        for key, value in performance.items()
        if key != "resourceUsage"
    }
    public_result = (
        result.get("publicResult")
        if isinstance(
            result.get("publicResult"),
            dict
        )
        else {}
    )
    return {
        "schemaVersion": 2,
        "outcome": {
            "success": result.get("success") is True,
            "message": result.get("message", ""),
            "failureStage": result.get("failureStage"),
            "stoppedEarly": bool(
                result.get(
                    "stoppedEarly",
                    False
                )
            )
        },
        "scoreboard": {
            "matchSize": result.get("matchSize"),
            "expectedPlayers": result.get("expectedPlayers"),
            "detectedPlayers": result.get("detectedPlayers"),
            "middleStat": result.get("middleStat")
        },
        "quality": {
            "validation": validation.get(
                "overall",
                "not_completed"
            ),
            "playersNeedingReview": review.get(
                "players_needing_review",
                0
            ),
            "allNamesMatched": matching.get(
                "all_matched",
                False
            ),
            "allNamesConfident": matching.get(
                "all_confident",
                False
            ),
            "confidenceSummary": public_result.get(
                "confidenceSummary",
                {}
            )
        },
        "pipelineVersions": result.get(
            "pipelineVersions",
            {}
        ),
        "configuration": {
            "debugLevel": OCR_DEBUG_LEVEL,
            "metricsIntervalSeconds": diagnostics.get(
                "resourceMonitoring",
                {}
            ).get("sampleIntervalSeconds"),
            "configuredCpuLimit": OCR_CPU_LIMIT,
            "configuredMemoryLimitMb": OCR_MEMORY_LIMIT_MB,
            "paddleDevice": "cpu",
            "gpuInferenceEnabled": False,
            "paddleMkldnnEnabled": bool(
                PADDLE_ENABLE_MKLDNN
            ),
            "paddleCpuThreads": int(
                PADDLE_CPU_THREADS
            )
        },
        "timings": timing_summary,
        "resources": diagnostics
    }
