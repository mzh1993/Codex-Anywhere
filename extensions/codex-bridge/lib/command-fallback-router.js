export async function handleCommandFallback({
  bridge,
  profile,
  request,
  parsed,
}) {
  if (parsed.name === "help") {
    await bridge.sendHelp(request, profile);
    return true;
  }

  if (parsed.name === "doctor") {
    const doctorText = await bridge.formatDoctor(profile.senderId, profile);
    await bridge.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      renderHint: "doctor",
      text: doctorText,
    });
    return true;
  }

  await bridge.sendUnknownCommand(request, parsed.name);
  return true;
}
