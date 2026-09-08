import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

/** Retired task kept only to remove registrations from earlier app installations. */
export const ALERT_TASK = 'price-alert-check';
TaskManager.defineTask(ALERT_TASK, async () => {
  await unregisterAlertTask();
  return BackgroundTask.BackgroundTaskResult.Success;
});

export async function unregisterAlertTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(ALERT_TASK)) await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
  } catch { /* Background tasks are unavailable on some native build targets. */ }
}
