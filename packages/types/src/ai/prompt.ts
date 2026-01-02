/**
 * AI Prompt 类型
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  template: string;
  variables: PromptVariable[];
  category: PromptCategory;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVariable {
  name: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
}

export type PromptCategory = 
  | 'TEXT_CLEANING'
  | 'REWRITING'
  | 'SUMMARIZATION'
  | 'TAGGING'
  | 'SEO'
  | 'QA'
  | 'CUSTOM';
