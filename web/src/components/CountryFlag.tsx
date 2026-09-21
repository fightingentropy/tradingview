import { Show, type Component } from "solid-js";

const flags = import.meta.glob<string>("../assets/flags/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const CountryFlag: Component<{ code: string }> = (props) => (
  <Show
    when={flags[`../assets/flags/${props.code.toLowerCase()}.svg`]}
    fallback={<span class="country-flag">{props.code}</span>}
  >
    {(src) => (
      <img
        class="country-flag"
        src={src()}
        alt=""
        width="24"
        height="24"
        decoding="async"
      />
    )}
  </Show>
);

export default CountryFlag;
