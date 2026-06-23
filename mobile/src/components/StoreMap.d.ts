// Shared type surface for the platform-split StoreMap (StoreMap.native.tsx / StoreMap.web.tsx).
// Lets TypeScript resolve `./StoreMap` while Metro picks the right platform file at bundle time.

import type { ReactElement } from "react";
import type { StoreNear } from "../api/client";

export type StoreMapProps = {
  center: { lat: number; lng: number };
  stores: StoreNear[];
  height?: number;
  onSelectStore?: (id: string) => void;
};

export declare function StoreMap(props: StoreMapProps): ReactElement;
