import json
import sys

from paddle_runtime import warm_model


def main():
    try:
        result = warm_model(
            trigger="container_build_prefetch"
        )
        print(
            json.dumps(
                result,
                indent=2,
                ensure_ascii=False
            )
        )
        return 0
    except Exception as error:
        print(
            f"Paddle model prefetch failed: {error}",
            file=sys.stderr
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(
        main()
    )
