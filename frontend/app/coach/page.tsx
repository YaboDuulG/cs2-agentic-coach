"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CloudMotifBg } from "@/components/patterns/mongolian";
import { Send, Bot, User, Sparkles } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function CoachPage() {
  const searchParams = useSearchParams();
  const matchId = searchParams?.get("match");
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: matchId 
        ? `Greetings, warrior. I see you wish to discuss match ${matchId}. What tactical wisdom do you seek?`
        : "Greetings. I am the Great Khan, your AI tactical coach. Submit your demo or ask a question about your playstyle.",
    }
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");

    // Real SSE call
    const fetchStream = async () => {
      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_id: matchId || null,
            query: input,
          }),
        });

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";

        // Create empty assistant message
        const asstId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: asstId, role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.substring(6);
              if (dataStr === "[DONE]") {
                 break;
              }
              try {
                const data = JSON.parse(dataStr);
                if (data.chunk) {
                  assistantContent += data.chunk;
                } else if (data.report && data.report.summary) {
                  assistantContent += data.report.summary;
                }
                
                setMessages(prev => prev.map(m => m.id === asstId ? { ...m, content: assistantContent } : m));
              } catch (e) {
                // Ignore parse errors on incomplete chunks
              }
            }
          }
        }
      } catch (err) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Sorry, I encountered an error communicating with the Great Khan network.",
        }]);
      }
    };

    fetchStream();
  };

  return (
    <div className="min-h-[calc(100vh-80px)] px-4 py-8 flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <CloudMotifBg />
      
      <div className="w-full max-w-4xl flex-1 flex flex-col relative z-10 h-[80vh] max-h-[800px]">
        <div className="mb-4 text-center">
          <h1 className="section-heading mb-2 flex items-center justify-center gap-3">
            <Sparkles className="text-[var(--color-accent-secondary)]" /> The Great Khan <Sparkles className="text-[var(--color-accent-secondary)]" />
          </h1>
          <p className="text-[var(--color-text-secondary)] font-mono text-sm">Strategic AI Advisor</p>
        </div>

        <div className="flex-1 card-elevated flex flex-col overflow-hidden">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                  msg.role === "user" 
                    ? "bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]" 
                    : "bg-[var(--color-accent-glow)] border-[var(--color-accent-primary)] shadow-glow"
                }`}>
                  {msg.role === "user" ? <User size={20} className="text-[var(--color-text-secondary)]" /> : <Bot size={20} className="text-[var(--color-accent-primary)]" />}
                </div>
                
                <div className={`max-w-[75%] p-4 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] rounded-tr-sm"
                    : "bg-[var(--color-bg-elevated)] border border-[var(--color-accent-glow)] text-[#F0F4FF] rounded-tl-sm shadow-card"
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border-primary)]">
            <form onSubmit={handleSend} className="relative flex items-center max-w-3xl mx-auto gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask for tactical advice or analyze a specific round..."
                className="flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] px-6 py-4 rounded-full focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)] transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="btn-primary rounded-full w-14 h-14 flex items-center justify-center flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={20} className="ml-1" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
