import { useEffect } from "react";

const fregeEmbedUrl = "https://mcp.frege.uz/v1/embed.js";
const fregeProjectId = "01a12ec1-1559-757c-ac99-7449a8da79f7";

type FregeClient = {
  setApiKey: (apiKey: string) => void;
  mount: (options: { el: string; project: string; stage: string; agent: string }) => void;
};

declare global {
  interface Window {
    Frege?: FregeClient;
  }
}

let fregeScriptPromise: Promise<void> | null = null;

function loadFregeScript() {
  if (window.Frege) return Promise.resolve();
  if (!fregeScriptPromise) {
    fregeScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = fregeEmbedUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        fregeScriptPromise = null;
        script.remove();
        reject(new Error("Frege chat skriptini yuklab bo‘lmadi."));
      };
      document.head.appendChild(script);
    });
  }
  return fregeScriptPromise;
}

export default function FregeChatWidget({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  useEffect(() => {
    if (!apiKey || !agentId) {
      console.error("Frege chat sozlanmagan. .env faylida VITE_FREGE_API_KEY va VITE_FREGE_AGENT_ID ni kiriting.");
      return;
    }

    let cancelled = false;
    void loadFregeScript()
      .then(() => {
        if (cancelled) return;
        if (!window.Frege) throw new Error("Frege chat SDK yuklandi, ammo Frege API topilmadi.");
        window.Frege.setApiKey(apiKey);
        window.Frege.mount({
          el: "#frege-chat",
          project: fregeProjectId,
          stage: "staging",
          agent: agentId,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("Frege chatni ishga tushirib bo‘lmadi.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, agentId]);

  if (!apiKey || !agentId) return null;

  return <div id="frege-chat" className="frege-chat-widget" aria-label="Frege chat" />;
}
