import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";

import { cn } from "@/lib/utils";

function Autocomplete<ItemValue>(
  props: Omit<AutocompletePrimitive.Root.Props<ItemValue>, "items"> & {
    items?: readonly ItemValue[];
  },
) {
  return <AutocompletePrimitive.Root data-slot="autocomplete" {...props} />;
}

function AutocompleteInput({
  className,
  ...props
}: AutocompletePrimitive.Input.Props) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(
        "h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-950 dark:text-slate-50 outline-none focus:ring-2 focus:ring-slate-300/70 dark:focus:ring-slate-600/70 placeholder:text-stone-400",
        className,
      )}
      spellCheck={false}
      autoCapitalize="none"
      autoComplete="off"
      {...props}
    />
  );
}

function AutocompleteContent({
  className,
  sideOffset = 5,
  children,
  ...props
}: AutocompletePrimitive.Popup.Props &
  Pick<AutocompletePrimitive.Positioner.Props, "sideOffset" | "align">) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            "z-50 max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto rounded-lg border border-[#DCD6CC] dark:border-slate-700 bg-[#FFFDFC] dark:bg-slate-800 p-1 text-xs text-stone-700 dark:text-stone-300 shadow-[0_12px_32px_rgba(57,47,38,0.16)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)] data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  );
}

function AutocompleteList({
  className,
  ...props
}: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn(className)}
      {...props}
    />
  );
}

function AutocompleteItem({
  className,
  ...props
}: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[0.72rem] leading-none outline-none transition select-none data-[highlighted]:bg-[#EEE9E1] dark:data-[highlighted]:bg-slate-700 data-[highlighted]:text-stone-900 dark:data-[highlighted]:text-stone-100",
        className,
      )}
      {...props}
    />
  );
}

function AutocompleteEmpty({
  className,
  ...props
}: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn(
        "px-2 py-1.5 text-[0.72rem] text-stone-400 dark:text-stone-500 empty:m-0 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
};
