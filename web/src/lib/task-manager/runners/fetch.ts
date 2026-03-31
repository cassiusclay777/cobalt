import FetchWorker from "$lib/task-manager/workers/fetch?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, itemError, queue } from "$lib/state/task-manager/queue";

import type { CobaltQueue, UUID } from "$lib/types/queue";

export const runFetchWorker = async (workerId: UUID, parentId: UUID, url: string) => {
    const worker = new FetchWorker();
    const WATCHDOG_TIMEOUT_MS = 120000;

    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const resetWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
            killWorker(worker, unsubscribe);
            itemError(parentId, workerId, "queue.fetch.network_error");
        }, WATCHDOG_TIMEOUT_MS);
    };

    const unsubscribe = queue.subscribe((queue: CobaltQueue) => {
        if (!queue[parentId]) {
            if (watchdog) clearTimeout(watchdog);
            killWorker(worker, unsubscribe);
        }
    });

    worker.postMessage({
        cobaltFetchWorker: {
            url
        }
    });
    resetWatchdog();

    worker.onmessage = (event) => {
        const eventData = event.data.cobaltFetchWorker;
        if (!eventData) return;
        resetWatchdog();

        if (eventData.progress) {
            updateWorkerProgress(workerId, {
                percentage: eventData.progress,
                size: eventData.size,
            })
        }

        if (eventData.result) {
            if (watchdog) clearTimeout(watchdog);
            killWorker(worker, unsubscribe);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.result,
            );
        }

        if (eventData.error) {
            if (watchdog) clearTimeout(watchdog);
            killWorker(worker, unsubscribe);
            return itemError(parentId, workerId, eventData.error);
        }
    }
}
