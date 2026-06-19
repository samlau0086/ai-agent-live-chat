import { ChatWidget } from "@/components/chat-widget";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  const params = await searchParams;
  if (params.embed === "1") {
    return (
      <main className="min-h-screen bg-transparent text-[#1d2433]">
        <ChatWidget />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#1d2433]">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-[#dde3ef] pb-4">
          <div>
            <p className="text-sm font-medium text-[#51607a]">AI Agent Live Chat</p>
            <h1 className="text-2xl font-semibold tracking-normal text-[#111827]">Customer support workspace</h1>
          </div>
          <div className="flex gap-2">
            <a
              className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-medium text-[#1f2a44] transition hover:bg-[#edf2f8]"
              href="/setup"
            >
              Setup
            </a>
            <a
              className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-medium text-[#1f2a44] transition hover:bg-[#edf2f8]"
              href="/agent"
            >
              Agent console
            </a>
          </div>
        </header>

        <div className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="flex flex-col justify-center">
            <div className="max-w-2xl">
              <p className="mb-3 text-sm font-semibold uppercase tracking-normal text-[#2e6f57]">Runnable MVP</p>
              <h2 className="text-4xl font-semibold tracking-normal text-[#111827] sm:text-5xl">
                AI first, human controlled live chat.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#51607a]">
                Visitors chat with the AI agent by default. Support staff can open the console, take over a live
                conversation, reply as a human, and release it back to AI when ready.
              </p>
              <div className="mt-8 grid gap-3 text-sm text-[#334155] sm:grid-cols-3">
                <div className="border-l-4 border-[#2e6f57] bg-white p-4 shadow-sm">
                  <strong className="block text-[#111827]">Anonymous visitor</strong>
                  Cookie-based session continuity.
                </div>
                <div className="border-l-4 border-[#3c6e9f] bg-white p-4 shadow-sm">
                  <strong className="block text-[#111827]">Manual takeover</strong>
                  Clear AI and human states.
                </div>
                <div className="border-l-4 border-[#b85c38] bg-white p-4 shadow-sm">
                  <strong className="block text-[#111827]">Extensible</strong>
                  Webhooks and tool registry included.
                </div>
              </div>
            </div>
          </section>

          <ChatWidget />
        </div>
      </section>
    </main>
  );
}
