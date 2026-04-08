export interface FaqItem       { id: string; q: string; a: string }
export interface HealthCheck   { id: string; name: string; url: string }
export interface Tier          { id: string; name: string; price: number; features: string[] }
export interface Industry      { id: string; name: string; tiers: Tier[] }

export interface SkedAIConfig {
  forwardPhone:    string;
  calendlyUrl:     string;
  supportFaq:      FaqItem[];
  healthCheckUrls: HealthCheck[];
  industries:      Industry[];
}
