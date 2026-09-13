import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone

import discord
from discord.ext import commands

import config

intents = discord.Intents.default()
intents.guilds = True
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

STATE_FILE = config.STATE_FILE


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def update_dashboard(quest: dict) -> None:
    path = config.DASHBOARD_JSON
    entries = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, OSError):
            entries = []
    entries.append(quest)
    entries = entries[-25:]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)


@bot.event
async def on_ready():
    guild = bot.get_guild(int(config.SERVER_ID))
    if guild is None:
        print(f"Cannot find server with ID {config.SERVER_ID}")
        return

    print(f"Connected as {bot.user} in {guild.name}")
    if config.MENTION_USER_ID:
        mention_target = int(config.MENTION_USER_ID)
        print(f"Quest watcher enabled on channel {config.QUEST_CHANNEL_ID} -> post/pin + mention <@{mention_target}> + dashboard")
    else:
        owner_id = guild.owner_id if guild.owner_id else None
        print(f"Quest watcher enabled on channel {config.QUEST_CHANNEL_ID} -> post/pin + mention server owner <@{owner_id}> + dashboard")
    try:
        await bot.tree.sync()
        print("Slash commands synced.")
    except Exception as e:
        print(f"Command sync failed: {e}")


async def purge_messages(channel, limit=None):
    deleted = 0
    count = None if limit is None else limit + 1
    async for msg in channel.history(limit=count):
        if msg.pinned or msg.embeds:
            continue
        try:
            await msg.delete()
            deleted += 1
            await asyncio.sleep(0.4)
        except discord.HTTPException:
            pass
    return deleted


@bot.event
async def on_message(message: discord.Message) -> None:
    if message.author == bot.user:
        return

    content = message.clean_content.strip()
    if content.startswith("مسح"):
        if not (message.author.guild_permissions.manage_messages or message.author == message.guild.owner):
            return
        if content == "مسح كل":
            try:
                await purge_messages(message.channel)
                await message.channel.send("🗑 Cleared all non-pinned, non-embed messages.")
            except discord.HTTPException as e:
                print(f"Built-in purge failed: {e}")
                return
            return
        m_num = re.fullmatch(r"مسح\s+(\d+)", content)
        if m_num:
            total = await purge_messages(message.channel, int(m_num.group(1)))
            await message.channel.send(f"🗑 Deleted {total} message(s).")
            return

    try:
        quest_channel_id = int(config.QUEST_CHANNEL_ID)
        target_channel_id = int(config.TARGET_CHANNEL_ID)
    except (TypeError, ValueError):
        return

    if message.channel.id != quest_channel_id:
        return

    state = load_state()
    announced = state.get("announced", [])

    if str(message.id) in announced:
        return

    mention = f"<@{config.MENTION_USER_ID}>" if config.MENTION_USER_ID else f"<@{message.guild.owner_id}>"
    dashboard = f"\n\nDashboard: {config.DASHBOARD_URL}" if config.DASHBOARD_URL else ""
    content = message.clean_content or "(no text content - see attachment)"
    if message.attachments:
        content += "\n" + "\n".join(a.url for a in message.attachments)

    payload = f"{mention} New quest posted!📣\n{content}{dashboard}"

    target = bot.get_channel(target_channel_id) or message.channel
    posted = await target.send(
        payload,
        allowed_mentions=discord.AllowedMentions(everyone=False, users=True, roles=False),
    )

    pinned_id = None
    try:
        await posted.pin(reason="Quest announcement")
        pinned_id = posted.id
    except discord.HTTPException:
        print("Pin failed: missing Manage Messages permission or pin limit reached.")

    quest = {
        "source_message_id": str(message.id),
        "posted_message_id": str(posted.id),
        "pinned": pinned_id is not None,
        "author": str(message.author),
        "content": content[:500],
        "channel": str(message.channel),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "jump_url": posted.jump_url,
    }
    update_dashboard(quest)

    announced.append(str(message.id))
    state["announced"] = announced
    save_state(state)
    print(f"[{quest['timestamp']}] New quest announced -> {posted.jump_url}")


@bot.tree.command(name="quests", description="List quests seen by the bot")
async def quests(ctx: discord.Interaction):
    path = config.DASHBOARD_JSON
    entries = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, OSError):
            entries = []
    if not entries:
        await ctx.response.send_message("No quests recorded yet.")
        return
    lines = [f"**{len(entries)} quest(s) recorded:**"]
    for e in reversed(entries[-10:]):
        lines.append(f"- {e['timestamp'][:16]} — {e['content'][:60]}\n  {e['jump_url']}")
    await ctx.response.send_message("\n".join(lines[:10]))


bot.run(config.DISCORD_TOKEN)