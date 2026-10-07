<script lang="ts">
  import { untrack } from "svelte";
  import type { ImageFilterControl } from "../../shared/image-filter-metadata";
  import type { BackgroundControlValue } from "../../shared/background-metadata";
  import {
    numericControlNeedsAdapter,
    numericControlKeyTransition,
    numericControlPointerValue,
    numericControlAriaValues,
    numericControlPercentage,
  } from "./numeric-control";
  const {
    control,
    values,
    source,
    disabled = false,
    onchange,
    oncommit,
  }: {
    control: ImageFilterControl;
    values: Record<string, BackgroundControlValue>;
    source: string;
    disabled?: boolean;
    oncommit: () => void;
    onchange: (key: string, value: BackgroundControlValue) => void;
  } = $props();
  let focused = $state(false);
  let draft = $state<BackgroundControlValue>("");
  let invalid = $state(false);
  const value = $derived(focused ? draft : (values[control.key] ?? ""));
  const id = $derived(`background-${source}-${control.key}`);
  const blocked = $derived(
    disabled ||
      !!(
        control.disabledWhen &&
        values[control.disabledWhen.key] === control.disabledWhen.equals
      ),
  );
  const hidden = $derived(
    !!(
      control.hiddenWhen &&
      values[control.hiddenWhen.key] === control.hiddenWhen.equals
    ),
  );
  // Off-lattice authored defaults must not be quantized by assigning a native range.
  function needsAdapter() {
    return (
      control.type === "number" &&
      numericControlNeedsAdapter(
        Number(values[control.key]),
        source,
        control.min,
        control.max,
        control.step,
      )
    );
  }
  let adapter = $state(untrack(needsAdapter));
  $effect(() => {
    // Promote only once the focused draft relinquishes ownership; never replace a live slider.
    if (!focused && needsAdapter()) adapter = true;
  });
  function change(next: BackgroundControlValue) {
    draft = next;
    onchange(control.key, next);
  }
  function focus() {
    if (!focused) draft = values[control.key] ?? "";
    focused = true;
  }
  function blur() {
    focused = false;
    oncommit();
  }
  function key(event: KeyboardEvent) {
    if (blocked || control.type !== "number") return;
    const next = numericControlKeyTransition(
      Number(value),
      event.key,
      control.min,
      control.max,
      control.step,
    );
    if (next === null) return;
    event.preventDefault();
    change(next);
  }
  let pointer: number | null = null;
  let touch: { x: number; y: number } | null = null;
  function setPointer(event: PointerEvent) {
    if (control.type !== "number") return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width)
      change(
        numericControlPointerValue(
          event.clientX,
          rect.left,
          rect.width,
          control.min,
          control.max,
          control.step,
        ),
      );
  }
  function down(event: PointerEvent) {
    if (blocked || !event.isPrimary || event.button !== 0 || pointer !== null)
      return;
    pointer = event.pointerId;
    (event.currentTarget as HTMLElement).focus();
    if (event.pointerType === "touch") {
      touch = { x: event.clientX, y: event.clientY };
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setPointer(event);
  }
  function move(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    if (touch) {
      const dx = event.clientX - touch.x,
        dy = event.clientY - touch.y;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      touch = null;
      if (Math.abs(dy) >= Math.abs(dx)) {
        pointer = null;
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId))
      setPointer(event);
  }
  function up(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    if (touch) setPointer(event);
    touch = null;
    pointer = null;
    oncommit();
  }
</script>

<label class="background-field" {hidden} data-disabled={blocked}>
  <span class="background-field__label" id={`${id}-label`}>{control.label}</span
  >
  {#if control.type === "number"}
    <output class="background-field__value" for={id}>{value}</output>
    {#if adapter}
      <div
        class="background-range-adapter"
        {id}
        data-background-control={control.key}
        tabindex={blocked ? -1 : 0}
        role="slider"
        aria-labelledby={`${id}-label`}
        aria-valuemin={control.min}
        aria-valuemax={control.max}
        aria-valuenow={numericControlAriaValues(
          Number(value),
          control.min,
          control.max,
        ).valueNow}
        aria-valuetext={numericControlAriaValues(
          Number(value),
          control.min,
          control.max,
        ).valueText ?? undefined}
        aria-disabled={blocked}
        onkeydown={key}
        onkeyup={oncommit}
        onfocus={focus}
        onblur={blur}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={() => {
          pointer = null;
          touch = null;
        }}
      >
        <span class="background-range-adapter__rail"
          ><span
            class="background-range-adapter__fill"
            style:width={`${String(Math.max(0, Math.min(100, numericControlPercentage(Number(value), control.min, control.max))))}%`}
          ></span><span
            class="background-range-adapter__thumb"
            style:left={`clamp(2.5px, ${String(Math.max(0, Math.min(100, numericControlPercentage(Number(value), control.min, control.max))))}%, calc(100% - 2.5px))`}
          ></span></span
        >
      </div>
    {:else}
      <input
        type="range"
        {id}
        data-background-control={control.key}
        min={control.min}
        max={control.max}
        step={control.step}
        value={Number(value)}
        disabled={blocked}
        onfocus={focus}
        onblur={blur}
        onkeydown={key}
        onkeyup={oncommit}
        oninput={(e) => {
          change(Number(e.currentTarget.value));
        }}
        onchange={oncommit}
      />
    {/if}
  {:else if control.type === "boolean"}
    <input
      type="checkbox"
      {id}
      data-background-control={control.key}
      checked={Boolean(value)}
      disabled={blocked}
      onchange={(e) => {
        change(e.currentTarget.checked);
        oncommit();
      }}
    />
  {:else if control.type === "color"}
    <span
      class="background-color-error"
      id={`${id}-label-error`}
      hidden={!invalid}
      aria-live="polite">Use #RRGGBB or #RRGGBBAA.</span
    >
    <input
      type="text"
      class="background-color-hex"
      {id}
      data-background-control={control.key}
      value={String(value)}
      maxlength="9"
      required
      pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"
      aria-label={`${control.label} hex color, optional alpha`}
      aria-describedby={`${id}-label-error`}
      aria-invalid={invalid}
      disabled={blocked}
      onfocus={focus}
      onblur={() => {
        if (!invalid) blur();
      }}
      oninput={(e) => {
        draft = e.currentTarget.value;
      }}
      onchange={(e) => {
        invalid = !e.currentTarget.checkValidity();
        if (!invalid) {
          change(e.currentTarget.value);
          oncommit();
        }
      }}
    />
  {:else}
    <select
      class="select"
      {id}
      data-background-control={control.key}
      value={String(value)}
      disabled={blocked}
      onchange={(e) => {
        change(e.currentTarget.value);
        oncommit();
      }}
    >
      {#each control.options as option (option.value)}<option
          value={option.value}>{option.label}</option
        >{/each}
    </select>
  {/if}
</label>
