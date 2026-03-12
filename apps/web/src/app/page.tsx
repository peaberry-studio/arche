import { redirect } from "next/navigation";

import { getSession } from "@/lib/runtime/session";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  redirect(`/u/${session.user.slug}`);
}
