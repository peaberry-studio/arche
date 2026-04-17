import YAML from 'yaml'

const SLACK_MANIFEST = {
  display_information: {
    name: 'Arche',
    description: 'Socket Mode Slack bot for Arche',
    background_color: '#111827',
  },
  features: {
    bot_user: {
      display_name: 'Arche',
      always_online: false,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        'app_mentions:read',
        'chat:write',
        'channels:history',
        'groups:history',
        'users:read',
      ],
    },
  },
  settings: {
    event_subscriptions: {
      bot_events: [
        'app_mention',
        'message.channels',
        'message.groups',
      ],
    },
    interactivity: {
      is_enabled: false,
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
}

export const SLACK_MANIFEST_YAML = YAML.stringify(SLACK_MANIFEST)
export const SLACK_MANIFEST_JSON = JSON.stringify(SLACK_MANIFEST, null, 2)
