export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const script = `
(function () {
  if (window.__aiAgentLiveChatLoaded) return;
  window.__aiAgentLiveChatLoaded = true;
  var frame = document.createElement("iframe");
  frame.src = "${origin}/?embed=1";
  frame.title = "AI Agent Live Chat";
  frame.style.position = "fixed";
  frame.style.right = "20px";
  frame.style.bottom = "20px";
  frame.style.width = "420px";
  frame.style.height = "640px";
  frame.style.maxWidth = "calc(100vw - 32px)";
  frame.style.maxHeight = "calc(100vh - 32px)";
  frame.style.border = "0";
  frame.style.zIndex = "2147483647";
  frame.style.boxShadow = "0 20px 50px rgba(15, 23, 42, 0.24)";
  document.body.appendChild(frame);
})();`;
  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
