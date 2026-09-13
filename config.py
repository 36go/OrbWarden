import os

from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
SERVER_ID = os.getenv("SERVER_ID")
QUEST_CHANNEL_ID = os.getenv("QUEST_CHANNEL_ID")
TARGET_CHANNEL_ID = os.getenv("TARGET_CHANNEL_ID") or os.getenv("QUEST_CHANNEL_ID")
MENTION_USER_ID = os.getenv("MENTION_USER_ID", "")
DASHBOARD_URL = os.getenv("DASHBOARD_URL")
DASHBOARD_JSON = os.getenv("DASHBOARD_JSON", "dashboard/quests.json")
STATE_FILE = os.getenv("STATE_FILE", "quest_state.json")