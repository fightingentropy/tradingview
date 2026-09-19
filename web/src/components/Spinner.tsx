import type { Component } from 'solid-js';

const Spinner: Component<{ label?: string }> = (props) => <span role="status" aria-label={props.label ?? 'Loading'} class="inline-flex items-center justify-center">
  <svg aria-hidden="true" class="h-5 w-5 animate-spin text-brand-slate-400" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
</span>;

export default Spinner;
