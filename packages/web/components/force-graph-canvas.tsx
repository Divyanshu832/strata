"use client";

import { useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";

/**
 * Thin wrapper so the graph can be lazy-loaded: next/dynamic doesn't forward refs, so the instance ref
 * travels as `fgRef`. Also sets the layout forces as soon as the instance exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ForceGraphCanvas({ fgRef, ...props }: { fgRef: React.RefObject<any> } & Record<string, any>) {
  const attach = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance: any) => {
      fgRef.current = instance;
      if (!instance) return;
      instance.d3Force("charge")?.strength(-140);
      instance.d3Force("link")?.distance(60);
    },
    [fgRef],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ForceGraph2D ref={attach} {...(props as any)} />;
}
