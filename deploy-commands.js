const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config.json");

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open the ticket dropdown"),
  new SlashCommandBuilder()
    .setName("sendpanel")
    .setDescription("Send the ticket panel to a specific channel")
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("The channel to send the panel in")
        .setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationCommands("1362022621121744946"), // replace with your Bot Application ID
      { body: commands }
    );

    console.log("✅ Slash commands registered.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();
