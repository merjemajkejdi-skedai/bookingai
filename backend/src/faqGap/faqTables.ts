export function getFaqTable(tenantType: string): string {
  switch (tenantType) {
    case 'hotel':            return 'hotel_faq';
    case 'shop':             return 'shop_faq';
    case 'general_business': return 'gb_faqs';
    case 'art_class':        return 'art_class_faq';
    default:
      console.warn(`[FaqGap] Unknown tenant type: ${tenantType} — falling back to hotel_faq`);
      return 'hotel_faq';
  }
}
