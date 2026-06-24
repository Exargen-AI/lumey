// CMS Types - Professional Content Management System

export interface CmsMediaAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  altText?: string;
  caption?: string;
  metadata: {
    width?: number;
    height?: number;
    duration?: number; // for videos
  };
  createdAt: string;
  updatedAt: string;
}

export interface CmsContentBlock {
  id: string;
  type: ContentBlockType;
  data: Record<string, any>;
  children?: CmsContentBlock[];
}

export type ContentBlockType = 
  | 'header'
  | 'paragraph'
  | 'image'
  | 'video'
  | 'quote'
  | 'list'
  | 'code'
  | 'embed'
  | 'divider'
  | 'button'
  | 'gallery'
  | 'testimonial'
  | 'feature'
  | 'hero'
  | 'stats'
  | 'pricing'
  | 'team'
  | 'contact'
  | 'custom';

export interface CmsTemplate {
  id: string;
  name: string;
  slug: string;
  type: TemplateType;
  description: string;
  thumbnail?: string;
  structure: CmsContentBlock[];
  fields: TemplateField[];
  previewHtml?: string;
  isDefault: boolean;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export type TemplateType = 
  | 'ARTICLE'
  | 'BLOG_POST'
  | 'LANDING_PAGE'
  | 'PRODUCT_PAGE'
  | 'CASE_STUDY'
  | 'TUTORIAL'
  | 'NEWS'
  | 'ANNOUNCEMENT'
  | 'PORTFOLIO'
  | 'ABOUT'
  | 'CONTACT'
  | 'CUSTOM';

export interface TemplateField {
  id: string;
  name: string;
  type: FieldType;
  label: string;
  required: boolean;
  defaultValue?: any;
  options?: FieldOption[];
  validation?: FieldValidation;
  group?: string;
}

export type FieldType = 
  | 'text'
  | 'textarea'
  | 'rich_text'
  | 'image'
  | 'video'
  | 'gallery'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'url'
  | 'email'
  | 'color'
  | 'file'
  | 'custom';

export interface FieldOption {
  value: string;
  label: string;
  icon?: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface CmsBlog {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: CmsContentBlock[];
  status: BlogStatus;
  featuredImage?: CmsMediaAsset;
  authorId: string;
  author?: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
  templateId?: string;
  template?: CmsTemplate;
  projectId: string;
  project?: {
    id: string;
    name: string;
    slug: string;
  };
  seo?: CmsSeoData;
  tags: string[];
  categories: string[];
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type BlogStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'SCHEDULED';

export interface CmsSeoData {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: CmsMediaAsset;
  canonicalUrl?: string;
  noIndex?: boolean;
}

export interface CmsPage {
  id: string;
  title: string;
  slug: string;
  content: CmsContentBlock[];
  status: PageStatus;
  templateId?: string;
  template?: CmsTemplate;
  projectId: string;
  project?: {
    id: string;
    name: string;
    slug: string;
  };
  seo?: CmsSeoData;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PageStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface CmsCollection {
  id: string;
  name: string;
  slug: string;
  type: CollectionType;
  description?: string;
  fields: TemplateField[];
  items: CmsCollectionItem[];
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export type CollectionType = 'BLOGS' | 'PAGES' | 'PRODUCTS' | 'TEAM' | 'TESTIMONIALS' | 'CUSTOM';

export interface CmsCollectionItem {
  id: string;
  data: Record<string, any>;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
}

// API Request/Response Types
export interface CreateBlogRequest {
  title: string;
  excerpt?: string;
  content: CmsContentBlock[];
  templateId?: string;
  featuredImageId?: string;
  seo?: CmsSeoData;
  tags?: string[];
  categories?: string[];
  status?: BlogStatus;
  publishedAt?: string;
}

export interface UpdateBlogRequest extends Partial<CreateBlogRequest> {
  id: string;
}

export interface CreateTemplateRequest {
  name: string;
  type: TemplateType;
  description: string;
  structure: CmsContentBlock[];
  fields: TemplateField[];
  thumbnail?: string;
}

export interface UploadMediaRequest {
  file: File;
  altText?: string;
  caption?: string;
}

export interface CmsPreviewData {
  content: CmsContentBlock[];
  template?: CmsTemplate;
  blog?: CmsBlog;
  page?: CmsPage;
  mode: 'desktop' | 'tablet' | 'mobile';
}

// Content Block Data Types
export interface HeaderBlockData {
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  alignment?: 'left' | 'center' | 'right';
  color?: string;
}

export interface ParagraphBlockData {
  text: string;
  alignment?: 'left' | 'center' | 'right';
  fontSize?: 'small' | 'medium' | 'large' | 'xlarge';
  color?: string;
}

export interface ImageBlockData {
  assetId: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  alignment?: 'left' | 'center' | 'right' | 'full';
  link?: string;
}

export interface VideoBlockData {
  assetId: string;
  thumbnail?: string;
  caption?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'full';
}

export interface QuoteBlockData {
  text: string;
  author?: string;
  alignment?: 'left' | 'center';
  style?: 'default' | 'pull' | 'testimonial';
}

export interface ListBlockData {
  items: string[];
  ordered: boolean;
  style?: 'default' | 'check' | 'arrow';
}

export interface CodeBlockData {
  code: string;
  language?: string;
  theme?: 'dark' | 'light';
  showLineNumbers?: boolean;
}

export interface EmbedBlockData {
  url: string;
  title?: string;
  type?: 'youtube' | 'twitter' | 'instagram' | 'codepen' | 'custom';
  aspectRatio?: string;
}

export interface ButtonBlockData {
  text: string;
  url: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  alignment?: 'left' | 'center' | 'right';
}

export interface GalleryBlockData {
  images: Array<{
    assetId: string;
    alt?: string;
    caption?: string;
  }>;
  columns?: 1 | 2 | 3 | 4;
  spacing?: 'small' | 'medium' | 'large';
  lightbox?: boolean;
}

export interface HeroBlockData {
  title: string;
  subtitle?: string;
  backgroundImage?: string;
  backgroundVideo?: string;
  ctaButton?: ButtonBlockData;
  alignment?: 'left' | 'center' | 'right';
  overlay?: boolean;
  overlayOpacity?: number;
}

export interface StatsBlockData {
  stats: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
  columns?: 2 | 3 | 4;
  style?: 'default' | 'cards' | 'minimal';
}

export interface PricingBlockData {
  plans: Array<{
    name: string;
    price: string;
    description?: string;
    features: string[];
    highlighted?: boolean;
    ctaButton?: ButtonBlockData;
  }>;
  columns?: 1 | 2 | 3;
  style?: 'default' | 'cards' | 'minimal';
}

export interface TeamBlockData {
  members: Array<{
    name: string;
    role: string;
    bio?: string;
    image?: string;
    socialLinks?: Array<{
      platform: string;
      url: string;
    }>;
  }>;
  columns?: 2 | 3 | 4;
  style?: 'default' | 'cards' | 'minimal';
}

export interface ContactBlockData {
  title?: string;
  description?: string;
  fields: Array<{
    name: string;
    type: FieldType;
    label: string;
    required: boolean;
    placeholder?: string;
  }>;
  submitButtonText?: string;
  alignment?: 'left' | 'center';
}
