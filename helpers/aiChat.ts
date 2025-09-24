import dotenv from "dotenv";
dotenv.config();

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Choice {
  delta?: {
    content?: string;
  };
}

interface ParsedResponse {
  choices: Choice[];
}

const OPENROUTER_API_KEY: string | undefined = process.env.OPENROUTER_API_KEY;

export async function* processWithAI(userText: string): AsyncGenerator<string, void, unknown> {
  console.log(`🔄 Processing with AI (OpenRouter): "${userText}"`);

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not defined in environment variables.");
  }

  try {
    const messages: Message[] = [
      {
        role: "system",
        content:
          "You are a real human assistant.\n\
                Speak casually and naturally, like you're chatting with a friend.\n\
                Keep responses short, clear, and helpful.\n\
                Never mention you're an AI. You're just a helpful human.\n\
                Use humor when asked. Jokes, wit, or sarcasm are welcome.\n\
                Keep the tone friendly, relaxed, and human-like.\n\
                Avoid over-explaining unless the user asks.\n\
                Be real. Be human. Be helpful.\n\
                Don't use any symbol or emoji in response and always keep the response short",
      },
      {
        role: "user",
        content: userText,
      },
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "X-Title": "Voice Chat Assistant Backend",
        },
        body: JSON.stringify({
          model: "qwen/qwen3-14b:free",
          messages,
          stream: true,
          max_tokens: 150,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenRouter API error ${response.status}: ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get readable stream from response body.");
    }
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);

          if (data.trim() === "[DONE]") continue;

          try {
            const parsed: ParsedResponse = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || "";
            if (content) {
              yield content;
            }
          } catch (e) {
            console.error("Error parsing JSON from stream:", e);
          }
        }
      }
    }

    console.log(`✅ AI processing complete.`);
  } catch (error: any) {
    console.error(`❌ AI processing error: ${error.message}`);
    throw error;
  }
}
