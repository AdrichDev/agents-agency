export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface WidgetTemplateConfig {
  position: "right" | "left";
  launcherShape: "circle" | "rounded";
  panelSize: "compact" | "normal" | "wide";
}

export interface AgentWizardForm {
  clientName: string;
  website: string;
  sector: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  skillIds: string[];
  channel: string;
  widgetPrimaryColor: string;
  widgetSecondaryColor: string;
  widgetAvatarBase64: string;
  widgetAvatarEmoji: string;
  widgetTemplateConfig: WidgetTemplateConfig;
}

