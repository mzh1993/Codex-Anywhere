export async function handleCommandFallback({
  bridge,
  profile,
  request,
  parsed,
}) {
  if (parsed.name === "doctor") {
    const doctorText = await bridge.formatDoctor(profile.senderId, profile);
    await bridge.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: doctorText,
    });
    return true;
  }

  await bridge.sendUnknownCommand(request, parsed.name);
  return true;
}
