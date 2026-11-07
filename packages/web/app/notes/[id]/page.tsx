import { Placeholder } from "@/components/nav";

// TODO(W4): middle = note (facts, history, sources, editable); right = backlinks, local graph, properties.
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Placeholder title="Note">Note {id} will render here.</Placeholder>;
}
