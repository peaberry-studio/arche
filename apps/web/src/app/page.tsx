import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";

export default async function Home() {
  const session = await getAuthenticatedUser();

  if (!session) {
    redirect("/login");
  }

  redirect(`/u/${session.user.slug}`);
}
