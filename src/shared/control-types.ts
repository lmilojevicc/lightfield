export type BackgroundControlValue = number | boolean | string;
export interface BaseControl {
  /** Optional selected-effect Advanced fold; existing controls remain unchanged. */
  advanced?: boolean;
  key: string;
  label: string;
  disabledWhen?: { key: string; equals: BackgroundControlValue };
  hiddenWhen?: { key: string; equals: BackgroundControlValue };
}

export interface NumberControl extends BaseControl {
  type: "number";
  min: number;
  max: number;
  step: number;
}

export interface BooleanControl extends BaseControl {
  type: "boolean";
}

export interface SelectControl extends BaseControl {
  type: "select";
  options: readonly { value: string; label: string }[];
}

export type BackgroundControl = NumberControl | BooleanControl | SelectControl;
