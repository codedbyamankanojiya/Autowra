/**
 * Central brand configuration.
 *
 * Nothing in the product should hardcode the brand name, support contact or
 * legal links. Change them here (or through the environment variables read by
 * `runtimeConfig`) and every screen / document picks the change up.
 */

export interface BrandContact {
  readonly supportPhone: string;
  readonly supportEmail: string;
  readonly whatsapp: string;
  readonly addressLine: string;
}

export interface BrandLinks {
  readonly website: string;
  readonly privacyPolicy: string;
  readonly termsAndConditions: string;
  readonly cancellationPolicy: string;
  readonly partnerTerms: string;
}

export interface BrandConfig {
  /** Product name shown to users. */
  readonly name: string;
  /** Short name used in tight spaces (tab labels, headers). */
  readonly shortName: string;
  /** Marketing tagline. */
  readonly tagline: string;
  /** Legal entity that invoices the customer. */
  readonly legalEntity: string;
  /** ISO-4217 currency code. All amounts are stored in minor units. */
  readonly currency: string;
  /** Symbol rendered next to prices. */
  readonly currencySymbol: string;
  /** Locale used for date / number formatting. */
  readonly locale: string;
  /** IANA timezone the operations team schedules in. */
  readonly timezone: string;
  readonly contact: BrandContact;
  readonly links: BrandLinks;
}

export const brand: BrandConfig = {
  name: 'Autowra',
  shortName: 'Autowra',
  tagline: 'Showroom shine, at your doorstep.',
  legalEntity: 'Autowra Mobility Services',
  currency: 'INR',
  currencySymbol: '₹',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  contact: {
    supportPhone: '+91 90000 00000',
    supportEmail: 'support@autowra.example',
    whatsapp: '+91 90000 00000',
    addressLine: 'Autowra Mobility Services, Bengaluru, Karnataka, India',
  },
  links: {
    website: 'https://autowra.example',
    privacyPolicy: 'https://autowra.example/legal/privacy',
    termsAndConditions: 'https://autowra.example/legal/terms',
    cancellationPolicy: 'https://autowra.example/legal/cancellation',
    partnerTerms: 'https://autowra.example/legal/partner-terms',
  },
};

/**
 * Mobile apps are bundled before runtime, so only `EXPO_PUBLIC_*` variables are
 * available. They are intentionally limited to non-secret, brand-level values.
 */
export function resolveBrandName(fallback: string = brand.name): string {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_BRAND_NAME : undefined;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : fallback;
}
