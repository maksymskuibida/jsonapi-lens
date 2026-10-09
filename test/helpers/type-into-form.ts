/**
 * Type into the **real** request form and press its real Save, returning the
 * exchange `main.ts` would hold (`onSave` folded in with `mergeExchange`).
 * Shared by every test that needs an exchange in the shape the product produces,
 * so no redaction or masking test seeds a field the UI never fills (D8).
 */
import { expect } from "vitest";
import { openRequestForm } from "../../src/request-form.js";
import type { RequestFormResult } from "../../src/request-form.js";
import { mergeExchange } from "../../src/exchange.js";
import type { Exchange } from "../../src/exchange.js";

export function resetModalRoot(): void {
  const root = document.createElement("div");
  root.id = "modal-root";
  const toast = document.createElement("div");
  toast.id = "toast";
  document.body.replaceChildren(root, toast);
}

interface Typed {
  url?: string;
  headers?: Array<[string, string]>;
  cookies?: Array<[string, string]>;
  contentType?: string;
  body?: string;
}

const set = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Type into the real form and Save; return the exchange `main.ts` would hold. */
export function typeIntoForm(typed: Typed): Exchange {
  let saved: RequestFormResult | null = null;
  openRequestForm({}, (result) => {
    saved = result;
  });
  const lists = [...document.querySelectorAll<HTMLElement>(".xform-rowlist")];
  const addRows = (list: HTMLElement, rows: Array<[string, string]> = []) => {
    for (const [name, value] of rows) {
      list.querySelector<HTMLButtonElement>(".btn--sm")!.click();
      const all = list.querySelectorAll<HTMLElement>(".xform-row");
      const row = all[all.length - 1]!;
      set(row.querySelector<HTMLInputElement>(".xform__name")!, name);
      set(row.querySelector<HTMLInputElement>(".xform__value")!, value);
    }
  };
  if (typed.url !== undefined) set(document.querySelector<HTMLInputElement>(".xform__url-input")!, typed.url);
  addRows(lists[1]!, typed.headers); // request headers (query is first)
  addRows(lists[2]!, typed.cookies); // request cookies
  const requestBody = document.querySelector<HTMLElement>(".xform-body")!;
  if (typed.contentType !== undefined) set(requestBody.querySelector<HTMLInputElement>("input")!, typed.contentType);
  if (typed.body !== undefined) set(requestBody.querySelector<HTMLTextAreaElement>("textarea")!, typed.body);
  document.querySelector<HTMLButtonElement>(".modal .modal__actions .xform__save")!.click();
  expect(saved, "the form saved").not.toBeNull();
  const { request, response } = saved as unknown as RequestFormResult;
  return mergeExchange({}, { request, response });
}

