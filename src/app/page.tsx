import { AtlasApp } from "@/components/atlas-app";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ passkey?: string }>;
}) {
  const user = await getCurrentUser();
  const query = await searchParams;
  return (
    <AtlasApp
      initialUser={user}
      initialPasskeyOffer={query.passkey === "offer"}
    />
  );
}
