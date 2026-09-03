export function getConversationsTable(tenantType: string): string {
  switch (tenantType) {
    case 'hotel':            return 'hotel_conversations';
    case 'shop':             return 'shop_conversations';
    case 'skedai':           return 'skedai_conversations';
    case 'art_class':        return 'art_class_conversations';
    case 'general_business': return 'gb_conversations';
    default:
      console.warn(`[Conversations] Unknown tenant type: ${tenantType} — falling back to hotel_conversations`);
      return 'hotel_conversations';
  }
}
