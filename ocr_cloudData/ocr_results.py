import copy

from paddle_runtime import get_runtime_status as get_paddle_runtime_status

RESULTS_VERSION = "results-v1.0-concise-detail-usage-split"


def build_public_result_from_ocr(result):
    result = result if isinstance(result, dict) else {}
    public_result = result.get("publicResult")
    if not isinstance(public_result, dict):
        public_result = {
            "team1": [],
            "team2": [],
            "validation": {
                "pass": False,
                "players_needing_review": 0
            },
            "confidenceSummary": {
                "overall": 0.0,
                "band": "very_low"
            },
            "status": "failed",
            "success": False
        }
    public_result = copy.deepcopy(public_result)
    success = result.get("success") is True
    public_result["success"] = success
    public_result["status"] = (
        "completed"
        if success
        else "failed"
    )
    validation = public_result.setdefault(
        "validation",
        {}
    )
    validation["pass"] = success
    full_validation = result.get(
        "validation",
        {}
    )
    review = (
        full_validation.get(
            "two_check_review",
            {}
        )
        if isinstance(full_validation, dict)
        else {}
    )
    validation["players_needing_review"] = int(
        review.get(
            "players_needing_review",
            validation.get(
                "players_needing_review",
                0
            )
        )
        or 0
    )
    public_result["matchSize"] = result.get(
        "matchSize"
    )
    public_result["expectedPlayers"] = result.get(
        "expectedPlayers"
    )
    public_result["detectedPlayers"] = result.get(
        "detectedPlayers"
    )
    public_result["middleStat"] = result.get(
        "middleStat"
    )
    public_result["pipelineVersions"] = copy.deepcopy(
        result.get(
            "pipelineVersions",
            {}
        )
    )
    performance = result.get(
        "performance",
        {}
    )
    if isinstance(performance, dict):
        runtime_seconds = performance.get(
            "totalSeconds"
        )
        if runtime_seconds is not None:
            public_result["runtimeSeconds"] = runtime_seconds
    return public_result


def build_client_job_response(job_id, job):
    job = job if isinstance(job, dict) else {}
    result = job.get("result")
    if not isinstance(result, dict):
        result = {
            "team1": [],
            "team2": [],
            "validation": {
                "pass": False,
                "players_needing_review": 0
            },
            "confidenceSummary": {
                "overall": 0.0,
                "band": "very_low"
            },
            "status": job.get(
                "status",
                "failed"
            ),
            "success": bool(
                job.get("success")
            )
        }
    response = {
        "jobId": job_id
    }
    response.update(
        copy.deepcopy(result)
    )
    response["status"] = job.get(
        "status",
        response.get(
            "status",
            "failed"
        )
    )
    response["progress"] = job.get(
        "progress",
        response.get(
            "progress",
            0
        )
    )
    response["stage"] = job.get(
        "stage",
        response.get(
            "stage",
            ""
        )
    )
    if job.get("message"):
        response["message"] = job["message"]
    return response


def build_detail_result(job_id, result):
    result = result if isinstance(result, dict) else {}
    performance = result.get(
        "performance",
        {}
    )
    if not isinstance(performance, dict):
        performance = {}
    stage_timings = {
        key: copy.deepcopy(value)
        for key, value in performance.items()
        if key != "resourceUsage"
    }
    public_result = result.get(
        "publicResult",
        {}
    )
    confidence_summary = (
        public_result.get(
            "confidenceSummary",
            {}
        )
        if isinstance(public_result, dict)
        else {}
    )
    return {
        "schemaVersion": 2,
        "resultsVersion": RESULTS_VERSION,
        "jobId": job_id,
        "success": result.get("success") is True,
        "status": (
            "completed"
            if result.get("success") is True
            else "failed"
        ),
        "message": result.get("message"),
        "failureStage": result.get("failureStage"),
        "pipelineVersions": copy.deepcopy(
            result.get(
                "pipelineVersions",
                {}
            )
        ),
        "matchSize": result.get("matchSize"),
        "playersPerTeam": result.get("playersPerTeam"),
        "expectedPlayers": result.get("expectedPlayers"),
        "detectedPlayers": result.get("detectedPlayers"),
        "middleStat": result.get("middleStat"),
        "confidenceSummary": copy.deepcopy(
            confidence_summary
        ),
        "preflight": copy.deepcopy(
            result.get(
                "preflightSummary",
                result.get(
                    "preflight",
                    {}
                )
            )
        ),
        "players": copy.deepcopy(
            result.get(
                "players",
                []
            )
        ),
        "validation": copy.deepcopy(
            result.get(
                "validation",
                {}
            )
        ),
        "serverValidation": copy.deepcopy(
            result.get(
                "serverValidation",
                {}
            )
        ),
        "performance": stage_timings
    }


def build_usage_result(job_id, result):
    result = result if isinstance(result, dict) else {}
    performance = result.get(
        "performance",
        {}
    )
    if not isinstance(performance, dict):
        performance = {}
    resources = performance.get(
        "resourceUsage",
        {}
    )
    if not isinstance(resources, dict):
        resources = {}
    overall = resources.get(
        "overall",
        {}
    )
    if not isinstance(overall, dict):
        overall = {}
    stage_timings = {
        key: copy.deepcopy(value)
        for key, value in performance.items()
        if key != "resourceUsage"
    }
    return {
        "schemaVersion": 2,
        "resultsVersion": RESULTS_VERSION,
        "jobId": job_id,
        "success": result.get("success") is True,
        "status": (
            "completed"
            if result.get("success") is True
            else "failed"
        ),
        "matchSize": result.get("matchSize"),
        "failureStage": result.get("failureStage"),
        "totalSeconds": performance.get(
            "totalSeconds",
            resources.get("wallSeconds")
        ),
        "wallSeconds": resources.get("wallSeconds"),
        "processTreeCpuSeconds": resources.get(
            "processTreeCpuSeconds",
            resources.get("processCpuSeconds")
        ),
        "averageCpuCoresUsed": resources.get(
            "averageCpuCoresUsed"
        ),
        "cpu": copy.deepcopy(
            overall.get(
                "cpu",
                {}
            )
        ),
        "memory": copy.deepcopy(
            overall.get(
                "memory",
                {}
            )
        ),
        "gpu": copy.deepcopy(
            overall.get(
                "gpu",
                {}
            )
        ),
        "resourceMonitoring": copy.deepcopy(
            resources.get(
                "resourceMonitoring",
                {}
            )
        ),
        "counters": copy.deepcopy(
            resources.get(
                "counters",
                {}
            )
        ),
        "stageTimings": stage_timings,
        "stageResources": copy.deepcopy(
            resources.get(
                "stages",
                {}
            )
        ),
        "paddleRuntime": get_paddle_runtime_status()
    }
