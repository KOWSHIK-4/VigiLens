# Container Resource Review Checklist

## Purpose
Review resource limits and runtime behavior for VigiLens services.

## Inspect
- Confirm each service has resource settings appropriate for its role and host capacity.
- Review CPU and memory usage during normal operation and representative inference load.
- Look for repeated restarts, out-of-memory terminations, and sustained throttling.
- Confirm health checks reflect service readiness rather than merely process existence.
- Check log rotation and storage growth for containers and volumes.
- Verify that only required ports are published to the host.

## Test
- Run a representative workload in a test environment.
- Observe resource usage and response times.
- Confirm the system degrades visibly when a dependency is unavailable.
- Confirm recovery after the load or dependency issue ends.

## Tuning
Change one relevant setting at a time and compare results against a recorded baseline. Do not remove resource limits or health checks as an unmeasured workaround.

## Record
Capture environment, workload, observations, changes, and rollback plan. A checklist alone does not prove the current deployment meets a resource target.
