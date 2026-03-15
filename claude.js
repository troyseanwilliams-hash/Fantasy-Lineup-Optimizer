import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const msg = await anthropic.messages.create({
  model: "claude-3-5-sonnet-latest",
  max_tokens: 200,
  messages: [
    { role: "user", content: "Explain dinosaurs like I'm 6." }
  ],
});

console.log(msg.content);
