## 2026-06-15 - Integer Overflow in Metric Conversion
**Vulnerability:** System and container metrics read as `uint64` (like Docker memory limits or `syscall.Statfs_t` block counts) were being directly cast to `int64`, leading to integer overflow (CWE-190) when limits are unbounded.
**Learning:** Docker represents unbound memory as max `uint64`. Go's syscall structs vary sizes across architectures. Unchecked casting creates negative values that break analytics algorithms and downstream aggregation.
**Prevention:** Always bound `uint64` values to `math.MaxInt64` before casting to `int64`, and explicitly handle architecture-dependent integer types by casting them upward (e.g., to `uint64`) before arithmetic operations.
