import { readOwnerOnlyText } from "@lervo/runtime-security";

export async function loadDiscordBotToken(path: string): Promise<string> {
  const token = (await readOwnerOnlyText(path, 4_096)).trim();
  if (token.length < 20 || token.length > 512 || /\s|\0/u.test(token)) {
    throw new Error("The Discord bot token file is invalid.");
  }
  return token;
}
