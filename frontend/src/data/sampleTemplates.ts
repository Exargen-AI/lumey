import { CmsTemplate, CmsContentBlock } from '@exargen/shared';

export const sampleTemplates: Omit<CmsTemplate, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Modern Blog Post',
    slug: 'modern-blog-post',
    type: 'BLOG_POST',
    description: 'Clean and modern blog post template with featured image support',
    thumbnail: '/templates/modern-blog.jpg',
    structure: [
      {
        id: 'hero',
        type: 'hero',
        data: {
          title: 'Your Blog Title Here',
          subtitle: 'A compelling subtitle that grabs attention',
          alignment: 'center',
          overlay: true,
          overlayOpacity: 0.4
        }
      },
      {
        id: 'intro',
        type: 'paragraph',
        data: {
          text: 'Start your blog post with an engaging introduction that hooks your readers and sets the tone for what\'s to come.',
          alignment: 'left',
          fontSize: 'large'
        }
      },
      {
        id: 'main-content',
        type: 'paragraph',
        data: {
          text: 'This is where your main content goes. You can add multiple paragraphs, images, quotes, and other content blocks to create a rich and engaging blog post.',
          alignment: 'left'
        }
      },
      {
        id: 'featured-image',
        type: 'image',
        data: {
          assetId: '',
          alt: 'Featured image',
          alignment: 'full',
          caption: 'Add a caption to your image to provide context'
        }
      },
      {
        id: 'quote',
        type: 'quote',
        data: {
          text: 'The only way to do great work is to love what you do.',
          author: 'Steve Jobs',
          alignment: 'center',
          style: 'pull'
        }
      },
      {
        id: 'conclusion',
        type: 'paragraph',
        data: {
          text: 'Wrap up your blog post with a strong conclusion that summarizes your key points and provides a call to action for your readers.',
          alignment: 'left'
        }
      }
    ],
    fields: [
      {
        id: 'title',
        name: 'title',
        type: 'text',
        label: 'Blog Title',
        required: true,
        defaultValue: 'Your Blog Title Here'
      },
      {
        id: 'subtitle',
        name: 'subtitle',
        type: 'textarea',
        label: 'Subtitle',
        required: false,
        defaultValue: 'A compelling subtitle'
      },
      {
        id: 'featured-image',
        name: 'featuredImage',
        type: 'image',
        label: 'Featured Image',
        required: false
      },
      {
        id: 'excerpt',
        name: 'excerpt',
        type: 'textarea',
        label: 'Excerpt',
        required: false,
        defaultValue: 'Brief description of your blog post'
      }
    ],
    isDefault: true
  },
  {
    name: 'Product Showcase',
    slug: 'product-showcase',
    type: 'PRODUCT_PAGE',
    description: 'Professional product page with hero, features, and pricing sections',
    thumbnail: '/templates/product-showcase.jpg',
    structure: [
      {
        id: 'hero',
        type: 'hero',
        data: {
          title: 'Product Name',
          subtitle: 'Transform your business with our innovative solution',
          alignment: 'center',
          overlay: true,
          overlayOpacity: 0.3
        }
      },
      {
        id: 'features',
        type: 'stats',
        data: {
          stats: [
            { label: 'Active Users', value: '10,000+', description: 'Growing daily' },
            { label: 'Success Rate', value: '98%', description: 'Customer satisfaction' },
            { label: 'Support', value: '24/7', description: 'Always here to help' }
          ],
          columns: 3,
          style: 'cards'
        }
      },
      {
        id: 'description',
        type: 'paragraph',
        data: {
          text: 'Discover how our product can revolutionize your workflow and boost productivity. Built with cutting-edge technology and designed for simplicity.',
          alignment: 'center',
          fontSize: 'large'
        }
      },
      {
        id: 'pricing',
        type: 'pricing',
        data: {
          plans: [
            {
              name: 'Starter',
              price: '$29/mo',
              description: 'Perfect for small teams',
              features: [
                'Up to 10 users',
                'Basic features',
                'Email support',
                '1GB storage'
              ],
              highlighted: false
            },
            {
              name: 'Professional',
              price: '$99/mo',
              description: 'Best for growing businesses',
              features: [
                'Up to 50 users',
                'Advanced features',
                'Priority support',
                '10GB storage',
                'API access'
              ],
              highlighted: true
            },
            {
              name: 'Enterprise',
              price: 'Custom',
              description: 'For large organizations',
              features: [
                'Unlimited users',
                'All features',
                'Dedicated support',
                'Unlimited storage',
                'Custom integrations',
                'SLA guarantee'
              ],
              highlighted: false
            }
          ],
          columns: 3,
          style: 'cards'
        }
      },
      {
        id: 'cta',
        type: 'button',
        data: {
          text: 'Start Free Trial',
          url: '#signup',
          variant: 'primary',
          size: 'large',
          alignment: 'center'
        }
      }
    ],
    fields: [
      {
        id: 'product-name',
        name: 'productName',
        type: 'text',
        label: 'Product Name',
        required: true,
        defaultValue: 'Product Name'
      },
      {
        id: 'tagline',
        name: 'tagline',
        type: 'textarea',
        label: 'Tagline',
        required: true,
        defaultValue: 'Product tagline'
      },
      {
        id: 'hero-image',
        name: 'heroImage',
        type: 'image',
        label: 'Hero Background Image',
        required: false
      },
      {
        id: 'pricing-plans',
        name: 'pricingPlans',
        type: 'custom',
        label: 'Pricing Plans',
        required: true
      }
    ],
    isDefault: false
  },
  {
    name: 'Case Study',
    slug: 'case-study',
    type: 'CASE_STUDY',
    description: 'Detailed case study template with client story and results',
    thumbnail: '/templates/case-study.jpg',
    structure: [
      {
        id: 'header',
        type: 'header',
        data: {
          text: 'Client Success Story',
          level: 1,
          alignment: 'center'
        }
      },
      {
        id: 'client-info',
        type: 'paragraph',
        data: {
          text: 'How Company X achieved 200% growth in 6 months using our solution',
          alignment: 'center',
          fontSize: 'large'
        }
      },
      {
        id: 'challenge',
        type: 'header',
        data: {
          text: 'The Challenge',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'challenge-desc',
        type: 'paragraph',
        data: {
          text: 'Company X was struggling with inefficient processes, low productivity, and high operational costs. They needed a comprehensive solution that could streamline their workflow and improve team collaboration.',
          alignment: 'left'
        }
      },
      {
        id: 'solution',
        type: 'header',
        data: {
          text: 'Our Solution',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'solution-desc',
        type: 'paragraph',
        data: {
          text: 'We implemented our complete platform with custom configurations to meet their specific needs. The solution included automated workflows, real-time collaboration tools, and advanced analytics.',
          alignment: 'left'
        }
      },
      {
        id: 'results',
        type: 'header',
        data: {
          text: 'Results',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'results-stats',
        type: 'stats',
        data: {
          stats: [
            { label: 'Productivity Increase', value: '200%', description: 'In 6 months' },
            { label: 'Cost Reduction', value: '40%', description: 'Annual savings' },
            { label: 'Team Satisfaction', value: '95%', description: 'Employee rating' },
            { label: 'ROI', value: '350%', description: 'First year return' }
          ],
          columns: 4,
          style: 'default'
        }
      },
      {
        id: 'testimonial',
        type: 'quote',
        data: {
          text: 'This solution transformed our business. The ROI exceeded our expectations, and our team has never been more productive.',
          author: 'John Doe, CEO at Company X',
          alignment: 'center',
          style: 'testimonial'
        }
      }
    ],
    fields: [
      {
        id: 'client-name',
        name: 'clientName',
        type: 'text',
        label: 'Client Name',
        required: true
      },
      {
        id: 'industry',
        name: 'industry',
        type: 'select',
        label: 'Industry',
        required: true,
        options: [
          { value: 'technology', label: 'Technology' },
          { value: 'healthcare', label: 'Healthcare' },
          { value: 'finance', label: 'Finance' },
          { value: 'retail', label: 'Retail' },
          { value: 'manufacturing', label: 'Manufacturing' }
        ]
      },
      {
        id: 'timeframe',
        name: 'timeframe',
        type: 'text',
        label: 'Implementation Timeframe',
        required: true
      },
      {
        id: 'key-metrics',
        name: 'keyMetrics',
        type: 'custom',
        label: 'Key Results Metrics',
        required: true
      }
    ],
    isDefault: false
  },
  {
    name: 'Tutorial Guide',
    slug: 'tutorial-guide',
    type: 'TUTORIAL',
    description: 'Step-by-step tutorial template with code blocks and examples',
    thumbnail: '/templates/tutorial.jpg',
    structure: [
      {
        id: 'title',
        type: 'header',
        data: {
          text: 'How to Build Amazing Things',
          level: 1,
          alignment: 'center'
        }
      },
      {
        id: 'intro',
        type: 'paragraph',
        data: {
          text: 'Learn step-by-step how to create incredible projects with our comprehensive guide. Perfect for beginners and experts alike.',
          alignment: 'left'
        }
      },
      {
        id: 'prerequisites',
        type: 'header',
        data: {
          text: 'Prerequisites',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'prereq-list',
        type: 'list',
        data: {
          items: [
            'Basic understanding of programming concepts',
            'Development environment setup',
            'Latest version of required tools',
            'Enthusiasm to learn!'
          ],
          ordered: false,
          style: 'check'
        }
      },
      {
        id: 'step1',
        type: 'header',
        data: {
          text: 'Step 1: Getting Started',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'step1-desc',
        type: 'paragraph',
        data: {
          text: 'First, let\'s set up our development environment and install the necessary dependencies.',
          alignment: 'left'
        }
      },
      {
        id: 'code-example',
        type: 'code',
        data: {
          code: `// Installation command
npm install amazing-package

// Import and use
import { AmazingThing } from 'amazing-package';

const thing = new AmazingThing();
thing.doSomethingAmazing();`,
          language: 'javascript',
          theme: 'dark',
          showLineNumbers: true
        }
      },
      {
        id: 'step2',
        type: 'header',
        data: {
          text: 'Step 2: Building Your Project',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'step2-desc',
        type: 'paragraph',
        data: {
          text: 'Now that we have everything set up, let\'s start building our amazing project step by step.',
          alignment: 'left'
        }
      },
      {
        id: 'conclusion',
        type: 'header',
        data: {
          text: 'Conclusion',
          level: 2,
          alignment: 'left'
        }
      },
      {
        id: 'conclusion-text',
        type: 'paragraph',
        data: {
          text: 'Congratulations! You\'ve successfully completed this tutorial. You now have the skills to build amazing things on your own.',
          alignment: 'left'
        }
      },
      {
        id: 'next-steps',
        type: 'button',
        data: {
          text: 'View Next Tutorial',
          url: '#next-tutorial',
          variant: 'primary',
          size: 'medium',
          alignment: 'center'
        }
      }
    ],
    fields: [
      {
        id: 'tutorial-title',
        name: 'tutorialTitle',
        type: 'text',
        label: 'Tutorial Title',
        required: true
      },
      {
        id: 'difficulty',
        name: 'difficulty',
        type: 'select',
        label: 'Difficulty Level',
        required: true,
        options: [
          { value: 'beginner', label: 'Beginner' },
          { value: 'intermediate', label: 'Intermediate' },
          { value: 'advanced', label: 'Advanced' }
        ]
      },
      {
        id: 'estimated-time',
        name: 'estimatedTime',
        type: 'text',
        label: 'Estimated Time',
        required: true
      },
      {
        id: 'tutorial-code',
        name: 'tutorialCode',
        type: 'custom',
        label: 'Code Examples',
        required: false
      }
    ],
    isDefault: false
  },
  {
    name: 'Landing Page',
    slug: 'landing-page',
    type: 'LANDING_PAGE',
    description: 'High-converting landing page with hero, features, and testimonials',
    thumbnail: '/templates/landing-page.jpg',
    structure: [
      {
        id: 'hero',
        type: 'hero',
        data: {
          title: 'Transform Your Business Today',
          subtitle: 'Join thousands of successful companies using our platform to grow faster and work smarter',
          alignment: 'center',
          overlay: true,
          overlayOpacity: 0.5
        }
      },
      {
        id: 'cta-primary',
        type: 'button',
        data: {
          text: 'Get Started Free',
          url: '#signup',
          variant: 'primary',
          size: 'large',
          alignment: 'center'
        }
      },
      {
        id: 'features',
        type: 'header',
        data: {
          text: 'Everything You Need to Succeed',
          level: 2,
          alignment: 'center'
        }
      },
      {
        id: 'features-desc',
        type: 'paragraph',
        data: {
          text: 'Our platform provides all the tools and features you need to take your business to the next level.',
          alignment: 'center'
        }
      },
      {
        id: 'feature-grid',
        type: 'stats',
        data: {
          stats: [
            { label: 'Analytics', value: 'Advanced', description: 'Real-time insights' },
            { label: 'Collaboration', value: 'Seamless', description: 'Team workflows' },
            { label: 'Security', value: 'Enterprise', description: 'Bank-level protection' },
            { label: 'Support', value: '24/7', description: 'Expert assistance' }
          ],
          columns: 4,
          style: 'cards'
        }
      },
      {
        id: 'testimonials',
        type: 'header',
        data: {
          text: 'What Our Customers Say',
          level: 2,
          alignment: 'center'
        }
      },
      {
        id: 'testimonial-1',
        type: 'quote',
        data: {
          text: 'This platform completely transformed how we work. Our productivity increased by 300% in just 3 months.',
          author: 'Sarah Johnson, CEO at TechCorp',
          alignment: 'center',
          style: 'testimonial'
        }
      },
      {
        id: 'testimonial-2',
        type: 'quote',
        data: {
          text: 'The best investment we\'ve made. The ROI exceeded all our expectations.',
          author: 'Mike Chen, Founder at StartupXYZ',
          alignment: 'center',
          style: 'testimonial'
        }
      },
      {
        id: 'final-cta',
        type: 'button',
        data: {
          text: 'Start Your Free Trial',
          url: '#trial',
          variant: 'primary',
          size: 'large',
          alignment: 'center'
        }
      }
    ],
    fields: [
      {
        id: 'headline',
        name: 'headline',
        type: 'text',
        label: 'Main Headline',
        required: true
      },
      {
        id: 'subheadline',
        name: 'subheadline',
        type: 'textarea',
        label: 'Subheadline',
        required: true
      },
      {
        id: 'cta-text',
        name: 'ctaText',
        type: 'text',
        label: 'CTA Button Text',
        required: true
      },
      {
        id: 'hero-background',
        name: 'heroBackground',
        type: 'image',
        label: 'Hero Background',
        required: false
      }
    ],
    isDefault: false
  },
  {
    name: 'About Us',
    slug: 'about-us',
    type: 'ABOUT',
    description: 'Professional about page with team and company story',
    thumbnail: '/templates/about-us.jpg',
    structure: [
      {
        id: 'title',
        type: 'header',
        data: {
          text: 'About Our Company',
          level: 1,
          alignment: 'center'
        }
      },
      {
        id: 'story',
        type: 'paragraph',
        data: {
          text: 'We\'re on a mission to transform how businesses work. Founded in 2020, we\'ve helped thousands of companies achieve their goals through innovative solutions and exceptional service.',
          alignment: 'center',
          fontSize: 'large'
        }
      },
      {
        id: 'values',
        type: 'header',
        data: {
          text: 'Our Values',
          level: 2,
          alignment: 'center'
        }
      },
      {
        id: 'values-desc',
        type: 'paragraph',
        data: {
          text: 'Our core values guide everything we do, from product development to customer support.',
          alignment: 'center'
        }
      },
      {
        id: 'values-grid',
        type: 'stats',
        data: {
          stats: [
            { label: 'Innovation', value: 'Always', description: 'Pushing boundaries' },
            { label: 'Quality', value: 'Excellence', description: 'No compromises' },
            { label: 'Customer Focus', value: 'First', description: 'Your success' },
            { label: 'Integrity', value: 'Unwavering', description: 'Built on trust' }
          ],
          columns: 4,
          style: 'cards'
        }
      },
      {
        id: 'team-title',
        type: 'header',
        data: {
          text: 'Meet Our Team',
          level: 2,
          alignment: 'center'
        }
      },
      {
        id: 'team-desc',
        type: 'paragraph',
        data: {
          text: 'We\'re a diverse group of passionate individuals dedicated to making a difference.',
          alignment: 'center'
        }
      },
      {
        id: 'team-members',
        type: 'team',
        data: {
          members: [
            {
              name: 'Alex Johnson',
              role: 'CEO & Founder',
              bio: 'Visionary leader with 15+ years experience',
              image: '',
              socialLinks: [
                { platform: 'linkedin', url: '#' },
                { platform: 'twitter', url: '#' }
              ]
            },
            {
              name: 'Sarah Williams',
              role: 'CTO',
              bio: 'Tech expert driving innovation',
              image: '',
              socialLinks: [
                { platform: 'linkedin', url: '#' },
                { platform: 'github', url: '#' }
              ]
            },
            {
              name: 'Mike Chen',
              role: 'Head of Design',
              bio: 'Creating beautiful user experiences',
              image: '',
              socialLinks: [
                { platform: 'linkedin', url: '#' },
                { platform: 'dribbble', url: '#' }
              ]
            }
          ],
          columns: 3,
          style: 'cards'
        }
      }
    ],
    fields: [
      {
        id: 'company-name',
        name: 'companyName',
        type: 'text',
        label: 'Company Name',
        required: true
      },
      {
        id: 'founding-year',
        name: 'foundingYear',
        type: 'number',
        label: 'Founding Year',
        required: true
      },
      {
        id: 'mission-statement',
        name: 'missionStatement',
        type: 'textarea',
        label: 'Mission Statement',
        required: true
      },
      {
        id: 'team-members',
        name: 'teamMembers',
        type: 'custom',
        label: 'Team Members',
        required: false
      }
    ],
    isDefault: false
  }
];

export const sampleBlogData = {
  title: 'Getting Started with Modern Web Development',
  slug: 'getting-started-modern-web-development',
  excerpt: 'Learn the fundamentals of modern web development with React, TypeScript, and cutting-edge tools.',
  content: [
    {
      id: 'intro',
      type: 'header' as const,
      data: {
        text: 'Welcome to Modern Web Development',
        level: 1,
        alignment: 'center'
      }
    },
    {
      id: 'intro-text',
      type: 'paragraph' as const,
      data: {
        text: 'Web development has evolved dramatically over the past decade. Today\'s developers have access to powerful tools, frameworks, and methodologies that make building complex applications easier than ever before.',
        alignment: 'left',
        fontSize: 'large'
      }
    },
    {
      id: 'what-youll-learn',
      type: 'header' as const,
      data: {
        text: 'What You\'ll Learn',
        level: 2,
        alignment: 'left'
      }
    },
    {
      id: 'learning-list',
      type: 'list' as const,
      data: {
        items: [
          'Modern JavaScript and TypeScript fundamentals',
          'React hooks and component architecture',
          'State management with Redux and Context API',
          'Building responsive layouts with CSS Grid and Flexbox',
          'API integration and data fetching',
          'Testing strategies and best practices',
          'Deployment and CI/CD pipelines'
        ],
        ordered: false,
        style: 'check'
      }
    },
    {
      id: 'tools-section',
      type: 'header' as const,
      data: {
        text: 'Essential Tools',
        level: 2,
        alignment: 'left'
      }
    },
    {
      id: 'tools-desc',
      type: 'paragraph' as const,
      data: {
        text: 'To succeed in modern web development, you need the right tools. Here are the essentials we\'ll be using throughout this guide.',
        alignment: 'left'
      }
    },
    {
      id: 'code-example',
      type: 'code' as const,
      data: {
        code: `// Modern React component with TypeScript
import React, { useState, useEffect } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
}

export const UserProfile: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const response = await fetch('/api/user');
      const userData = await response.json();
      setUser(userData);
    } catch (error) {
      console.error('Failed to fetch user:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div className="user-profile">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
};`,
        language: 'typescript',
        theme: 'dark',
        showLineNumbers: true
      }
    },
    {
      id: 'conclusion',
      type: 'header' as const,
      data: {
        text: 'Conclusion',
        level: 2,
        alignment: 'left'
      }
    },
    {
      id: 'conclusion-text',
      type: 'paragraph' as const,
      data: {
        text: 'Modern web development offers incredible opportunities for developers to create amazing applications. By mastering these tools and concepts, you\'ll be well-equipped to tackle any project that comes your way.',
        alignment: 'left'
      }
    }
  ] as CmsContentBlock[],
  status: 'PUBLISHED' as const,
  tags: ['web-development', 'react', 'typescript', 'tutorial'],
  categories: ['Technology', 'Programming'],
  seo: {
    title: 'Getting Started with Modern Web Development - Complete Guide',
    description: 'Learn modern web development with React, TypeScript, and cutting-edge tools. Complete tutorial for beginners and experienced developers.',
    keywords: ['web development', 'react', 'typescript', 'javascript', 'tutorial'],
    noIndex: false
  }
};
