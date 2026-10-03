# Detached launch evidence

The launch helper spawns the current Node executable with the supplied entry and arguments, the repository working directory, inherited environment, detached mode, and ignored stdio. It installs an error listener that discards asynchronous launch errors and unreferences the child. A synchronous exception returns false; reaching the return after spawn and unref returns true.

True proves only that the helper reached its return. It does not prove successful child startup, provider invocation, job processing, or lifecycle completion. Canonical worker outcomes and lifecycle evidence remain necessary.

Historical failure-code records without reconstructable source bindings cannot establish either old-change coverage or present currency.
