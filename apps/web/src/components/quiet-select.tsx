"use client";

import { Children, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

const QuietSelectContext = createContext(false);

export function QuietSelectScope({ children }: { children: ReactNode }) {
  return <QuietSelectContext.Provider value>{children}</QuietSelectContext.Provider>;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;
type OptionProps = { value?: string | number; label?: string; children?: ReactNode; "data-technical"?: boolean };

function text(node: ReactNode): string {
  return Children.toArray(node).map((child) => typeof child === "string" || typeof child === "number" ? String(child) : isValidElement<OptionProps>(child) ? text(child.props.children) : "").join("");
}

function options(children: ReactNode): Array<{ value: string; label: string; technical: boolean }> {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type !== "option") return options(child.props.children);
    const label = child.props.label ?? text(child.props.children);
    return [{ value: String(child.props.value ?? text(child.props.children)), label, technical: child.props["data-technical"] === true }];
  });
}

/** Outside the Quiet rollout this renders exactly the original native select. */
export function QuietSelect({ technical = false, ...props }: SelectProps & { technical?: boolean }) {
  const quiet = useContext(QuietSelectContext);
  return quiet && !props.multiple && (props.size ?? 0) <= 1 ? <WrappingSelect {...props} technical={technical} /> : <select {...props} />;
}

function WrappingSelect({ children, className, onChange, technical, ...props }: SelectProps & { technical: boolean }) {
  const select = useRef<HTMLSelectElement>(null);
  const choices = options(children);
  const [selection, setSelection] = useState(String(props.defaultValue ?? choices[0]?.value ?? ""));
  const selected = String(props.value ?? selection);
  const choice = choices.find((option) => option.value === selected) ?? choices[0];
  const caption = choice?.label ?? "";

  // Read native selection after option-list changes, including browser fallback selection.
  useLayoutEffect(() => {
    if (select.current) setSelection(select.current.value);
  }, [children, props.value, props.defaultValue]);

  useEffect(() => {
    const form = select.current?.form;
    const reset = () => queueMicrotask(() => { if (select.current) setSelection(select.current.value); });
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [props.form]);

  return <span className={`q-reflow-select ${className ?? ""}`} style={props.style} data-technical={technical || choice?.technical || undefined}>
    <span className="q-select-value" aria-hidden="true">{caption}</span>
    <span className="q-select-caret" aria-hidden="true">▾</span>
    <select {...props} ref={select} className={className} onChange={(event) => { setSelection(event.currentTarget.value); onChange?.(event); }}>{children}</select>
  </span>;
}
