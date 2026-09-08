export const createLatestAnimationFrameBatcher = <T>(
  flush: (value: T) => void,
) => {
  let frame: number | undefined;
  let latest: T | undefined;

  const push = (value: T) => {
    latest = value;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const valueToFlush = latest;
      latest = undefined;
      if (valueToFlush !== undefined) flush(valueToFlush);
    });
  };

  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    latest = undefined;
  };

  return { push, cancel };
};
