import { AppShell, NoAccess } from "@/components/AppShell";
import { Chat } from "@/components/Chat";
import { PrivacyGate } from "@/components/PrivacyGate";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy";

// Answers can take a while (several tool rounds).
export const maxDuration = 120;

export default async function ChatPage() {
  const user = await getUser();
  if (!user) return <NoAccess />;

  const [ack] = await db()`
    select 1 from chatbot.privacy_acks where email = ${user.email} and version = ${PRIVACY_NOTICE_VERSION}`;

  return <AppShell user={user}>{ack ? <Chat /> : <PrivacyGate />}</AppShell>;
}
