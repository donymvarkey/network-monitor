import { RouterDetail } from "./router-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RouterDetail id={id} />;
}
