import { Show, createContext, createMemo, createSignal, onCleanup, onMount, useContext, type Accessor, type ParentComponent } from "solid-js";

const PageActivity = createContext<Accessor<boolean>>(() => true);
export const usePageActive = () => useContext(PageActivity);

/** Mount on the first visit, then retain the DOM, scroll position and local state. */
const PageView: ParentComponent<{ active: boolean; name: string }> = (props) => {
  const visited = createMemo((previous) => previous || props.active, false);
  const [visible, setVisible] = createSignal(!document.hidden);
  const active = createMemo(() => props.active && visible());
  onMount(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    onCleanup(() => document.removeEventListener("visibilitychange", update));
  });

  return <Show when={visited()}>
    <div data-page={props.name} class="min-h-0 flex-1 flex-col overflow-hidden"
      style={{ display: props.active ? "flex" : "none" }}
      aria-hidden={!props.active} inert={!props.active}>
      <PageActivity.Provider value={active}>{props.children}</PageActivity.Provider>
    </div>
  </Show>;
};

export default PageView;
