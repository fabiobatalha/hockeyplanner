import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore


logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    pass


class EmailTasks:
    def __init__(self, workers: int = 2, capacity: int = 16) -> None:
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="hockeyplanner-email")
        self.slots = BoundedSemaphore(capacity)

    def submit(self, task: Callable, *args) -> None:
        if not self.slots.acquire(blocking=False):
            raise EmailDeliveryError("Email delivery is busy. Try again later.")
        try:
            self.executor.submit(self._run, task, args)
        except RuntimeError as error:
            self.slots.release()
            raise EmailDeliveryError("Email delivery is unavailable. Try again later.") from error

    def _run(self, task: Callable, args: tuple) -> None:
        try:
            task(*args)
        except Exception as error:
            cause = error.__cause__ or error
            logger.error("Email task %s failed (%s).", task.__qualname__, type(cause).__name__)
        finally:
            self.slots.release()
