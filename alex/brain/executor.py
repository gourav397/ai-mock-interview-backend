import time


class AgentExecutor:

    MAX_ITER = 8
    TIMEOUT_S = 120

    MUTATING_ACTIONS = {
        "fs.write",
        "fs.move",
        "fs.delete",
        "app.close",
        "mouse.click",
        "keyboard.type",
    }

    def __init__(
        self,
        tools,
        gate,
        broker,
        audit,
        context
    ):
        self.tools = tools or {}
        self.gate = gate
        self.broker = broker
        self.audit = audit
        self.ctx = context

    # ==========================================================
    # TOOL
    # ==========================================================

    def _get_tool(
        self,
        name
    ):
        return self.tools.get(
            name
        )

    # ==========================================================
    # CONFIRMATION
    # ==========================================================

    def _needs_confirmation(
        self,
        step
    ):
        if step.needs_confirmation:
            return True

        return (
            step.action
            in self.MUTATING_ACTIONS
        )

    def _confirm(
        self,
        step
    ):
        if not self._needs_confirmation(
            step
        ):
            return True

        description = (
            f"ALEX wants to execute "
            f"{step.action} "
            f"with {step.params}"
        )

        # Existing ConfirmationBroker
        # uses require().
        try:
            if hasattr(
                self.broker,
                "require"
            ):
                self.broker.require(
                    description
                )
                return True

            # Compatibility with a future
            # request_confirmation API.
            if hasattr(
                self.broker,
                "request_confirmation"
            ):
                return bool(
                    self.broker.request_confirmation(
                        step.action,
                        step.params
                    )
                )

        except Exception:
            return False

        # Never silently execute
        # a risky operation.
        return False

    # ==========================================================
    # AUDIT
    # ==========================================================

    def _audit(
        self,
        action,
        detail,
        status="ok"
    ):
        try:
            if hasattr(
                self.audit,
                "log"
            ):
                self.audit.log(
                    "alex",
                    action,
                    detail,
                    status
                )
        except Exception:
            pass

    # ==========================================================
    # EXECUTION
    # ==========================================================

    def run(
        self,
        steps
    ):
        if not steps:
            return self._summary(
                False,
                "No executable plan was created."
            )

        start = time.time()
        completed = []

        for index, step in enumerate(
            steps
        ):

            if index >= self.MAX_ITER:
                return self._summary(
                    False,
                    "Safety iteration limit reached.",
                    completed
                )

            if (
                time.time()
                - start
                > self.TIMEOUT_S
            ):
                return self._summary(
                    False,
                    "Task timeout reached.",
                    completed
                )

            try:
                if not self._confirm(
                    step
                ):
                    self._audit(
                        step.action,
                        step.params,
                        "confirmation_denied"
                    )

                    return self._summary(
                        False,
                        "Owner confirmation was not granted.",
                        completed
                    )

                fn = self._get_tool(
                    step.action
                )

                if fn is None:
                    return self._summary(
                        False,
                        f"Unknown tool: {step.action}",
                        completed
                    )

                self._audit(
                    step.action,
                    step.params,
                    "started"
                )

                result = fn(
                    **(
                        step.params
                        or {}
                    )
                )

                step.result = (
                    result
                    if isinstance(
                        result,
                        dict
                    )
                    else {
                        "ok": True,
                        "result": result,
                    }
                )

                verified = (
                    self._evaluate(
                        step
                    )
                )

                if verified:
                    step.verified = True

                    completed.append(
                        {
                            "action":
                                step.action,
                            "success":
                                True,
                            "result":
                                step.result,
                        }
                    )

                    self._audit(
                        step.action,
                        step.result,
                        "verified"
                    )

                    continue

                # ------------------------------------------------
                # FALLBACK
                # ------------------------------------------------

                if step.on_fail:
                    fallback = (
                        self._get_tool(
                            step.on_fail
                        )
                    )

                    if fallback:
                        self._audit(
                            step.on_fail,
                            step.params,
                            "fallback_started"
                        )

                        step.result = fallback(
                            **(
                                step.params
                                or {}
                            )
                        )

                        if isinstance(
                            step.result,
                            dict
                        ):
                            verified = (
                                self._evaluate(
                                    step
                                )
                            )
                        else:
                            verified = bool(
                                step.result
                            )

                        if verified:
                            step.verified = True

                            completed.append(
                                {
                                    "action":
                                        step.on_fail,
                                    "success":
                                        True,
                                    "fallback":
                                        True,
                                    "result":
                                        step.result,
                                }
                            )

                            continue

                return self._summary(
                    False,
                    f"{step.action} executed but verification failed.",
                    completed
                )

            except Exception as error:

                message = str(
                    getattr(
                        error,
                        "message",
                        None
                    )
                    or error
                )

                self._audit(
                    step.action,
                    message,
                    "failed"
                )

                # Try explicit fallback.
                if step.on_fail:
                    try:
                        fallback = (
                            self._get_tool(
                                step.on_fail
                            )
                        )

                        if fallback:
                            step.result = fallback(
                                **(
                                    step.params
                                    or {}
                                )
                            )

                            if self._evaluate(
                                step
                            ):
                                completed.append(
                                    {
                                        "action":
                                            step.on_fail,
                                        "success":
                                            True,
                                        "fallback":
                                            True,
                                        "result":
                                            step.result,
                                    }
                                )
                                continue

                    except Exception:
                        pass

                return self._summary(
                    False,
                    f"{step.action} failed: {message}",
                    completed
                )

        return self._summary(
            True,
            "All planned steps completed and verified.",
            completed
        )

    # ==========================================================
    # VERIFY
    # ==========================================================

    def _evaluate(
        self,
        step
    ):
        result = step.result

        if result is None:
            return False

        if isinstance(
            result,
            dict
        ):
            if result.get(
                "success"
            ) is False:
                return False

            if result.get(
                "status"
            ) in (
                "failed",
                "denied",
                "error",
            ):
                return False

        if step.verify:
            verifier = (
                self._get_tool(
                    step.verify
                )
            )

            if verifier:
                try:
                    value = verifier(
                        **(
                            step.params
                            or {}
                        )
                    )

                    if isinstance(
                        value,
                        dict
                    ):
                        return bool(
                            value.get(
                                "success",
                                value.get(
                                    "ok",
                                    False
                                )
                            )
                        )

                    return bool(
                        value
                    )

                except Exception:
                    return False

        return True

    # ==========================================================
    # SUMMARY
    # ==========================================================

    def _summary(
        self,
        success,
        message,
        completed=None
    ):
        return {
            "success": bool(
                success
            ),
            "message": str(
                message
            ),
            "completed": (
                completed or []
            ),
        }