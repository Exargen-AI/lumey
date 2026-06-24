# CMS Documentation

## What This CMS Is

This CMS is a content management system built inside Exargen Command Center.

Its purpose is to let your team manage website content from one place without editing the website code every time.

With this CMS, your team can:

- create content projects for different websites
- make blog templates
- write and manage blogs
- upload images and media
- publish content for external websites to display

In simple words, this CMS works like a central content panel, and your website can fetch published content from it.

## Main Idea

The CMS works in two parts:

1. Internal content management
   Your team logs in to Exargen Command Center and creates content.

2. External website integration
   Your website connects to the CMS and shows the published content to visitors.

So the CMS is the place where content is created, and the website is the place where content is displayed.

## How It Is Organized

The CMS is built around 4 main parts.

### 1. Content Project

A content project represents one website or one content space.

For example:

- company website
- product blog
- marketing site
- news portal

Each content project has:

- a name
- a unique slug
- a domain if needed
- an API key
- active or inactive status

The API key is important because external websites use it to read content from this CMS.

### 2. Template

A template is a starter layout for content.

It helps editors avoid creating every blog from scratch.

For example, you can create templates like:

- article template
- tutorial template
- case study template
- announcement template

A template gives the starting structure, but after applying it, the editor can still change the content freely.

### 3. Blog

A blog is the main published content item in the CMS.

Each blog can have:

- title
- slug
- excerpt
- main content
- featured image
- SEO information
- tags
- categories
- publish status
- author

This is the content that will usually appear on the website.

### 4. Media Assets

Media assets are uploaded files used inside blogs.

Examples:

- images
- screenshots
- documents
- videos

These files are stored by the backend and then used inside blog content.

## How Content Is Created

The content flow is simple.

### Step 1. Create a content project

First, create a CMS project for the website.

Example:

- Furix Website
- Exargen Blog
- Product Help Center

This project becomes the container for all templates, blogs, and media of that website.

### Step 2. Create templates if needed

Templates are optional, but useful.

They help standardize blog structure and save time for content writers.

### Step 3. Create a blog

When creating a blog, the editor can:

- write the title
- generate or edit the slug
- add a short summary
- choose a featured image
- add tags and categories
- fill SEO details
- write the main content

### Step 4. Save draft or publish

Blogs can stay as drafts until ready.

Once published, they become available for the external website to use.

## How The Editor Works

The CMS uses a block-based editor.

That means content is built using separate blocks instead of one long text field.

Examples of supported blocks:

- headings
- paragraphs
- images
- videos
- quotes
- lists
- code blocks
- embeds
- buttons
- gallery
- hero section
- stats section
- pricing section
- team section
- contact section

This makes the content more flexible and suitable for modern websites.

## How Templates Work

Templates in this CMS are not locked designs.

They work more like starter structures.

When an editor chooses a template:

- the template content is copied into the blog
- the blog gets a ready-made starting layout
- the editor can then edit, remove, or add blocks freely

So templates are helpful starting points, not fixed layouts.

## How Media Upload Works

Editors can upload media inside the CMS.

That media is then connected to the selected content project and can be used in blogs.

Uploaded media is used for:

- featured images
- content images
- gallery blocks
- hero sections
- other visual parts of the blog

Once uploaded, the system stores the file and gives it a public path that websites can load.

## Blog Status

Blogs currently use these main statuses:

- Draft
- Published
- Archived

### Draft

The blog is still being worked on and is not public.

### Published

The blog is ready and can be shown on the website.

### Archived

The blog is no longer active for normal display.

## What Gets Sent To The Website

When a website connects to the CMS, it receives the published blog data.

That data includes things like:

- title
- slug
- summary
- author
- publish date
- tags
- categories
- featured image
- SEO fields
- content blocks

The website then reads this content and displays it to visitors.

## How Website Integration Works

The CMS is designed to work like a headless CMS.

That means:

- the CMS manages content
- the website displays the content
- both are connected through the API

In practice, this means your website does not need hardcoded blog content.

Instead, it asks the CMS for published content and shows it dynamically.

## Simple Integration Flow

Here is the easiest way to understand the integration:

1. Your team creates blogs in the CMS
2. The blog is published
3. The website connects to the CMS using the project API key
4. The website fetches the list of blogs or a single blog
5. The website displays that content on blog pages

So the CMS becomes the source of truth for content.

## What The Website Usually Needs

A website usually needs these CMS features:

### Blog listing page

This page shows all published blogs.

It usually displays:

- blog title
- short description
- featured image
- author
- publish date
- tags or category

### Blog detail page

This page shows one full blog.

It usually displays:

- title
- featured image
- full content
- SEO information

### Tag or category pages

The website can also group blogs by:

- category
- tag
- author

This helps organize content better.

## Best Way To Integrate With Websites

The recommended setup is:

- use the CMS only for content management
- let the website fetch published content from the CMS
- keep the API key secure on the website backend if possible

This approach is best because:

- content becomes easy to update
- the website stays clean and flexible
- non-developers can manage content
- the same CMS can support multiple websites

## Good Use Cases

This CMS is a good fit for:

- company blogs
- marketing websites
- landing pages with reusable content blocks
- tutorial or knowledge websites
- product updates
- announcement pages
- case study content

## Permissions And Access

Inside Exargen Command Center, users need the right permissions to manage CMS content.

There are separate permissions for:

- viewing projects
- creating projects
- editing projects
- deleting projects
- managing blogs
- managing templates

This helps control who can create, edit, and publish content.

## Public Content Access

Internal CMS usage requires login and permissions.

But public website access works differently.

The external website uses the project API key to read published content.

This means:

- editors need login access
- public websites do not need dashboard login
- websites only need the correct project connection details

## SEO Support

Each blog can also store SEO information.

This helps the website improve search engine visibility.

SEO fields can include:

- SEO title
- meta description
- keywords
- Open Graph image
- canonical URL

This is useful for:

- Google search results
- social sharing previews
- better page metadata

## Current Scope Of This CMS

What is fully available right now:

- content projects
- templates
- blogs
- media uploads
- public blog delivery
- editor preview
- SEO fields for blogs

What is only partial or planned for future growth:

- full page management
- collection-based content types
- advanced publishing workflows
- more structured template systems

So currently this CMS is best understood as a blog and content delivery system, not yet a full enterprise page builder.

## Strengths Of This CMS

Some strong points of the current implementation:

- simple project-based structure
- clear separation between admin content and public website content
- reusable templates
- flexible block-based editor
- media management
- public delivery for websites
- suitable for multi-site content handling

## Limitations To Keep In Mind

Some current limitations:

- content is mainly blog-focused right now
- templates are starter structures, not strict layout systems
- media is stored locally on the server
- pages and collections are not fully implemented yet

These are not blockers for normal blog usage, but they matter for larger future expansion.

## Recommended Production Approach

If you want to use this CMS in production, the best approach is:

- keep the CMS backend hosted properly
- use stable file storage
- keep the API key secure
- let the website fetch only published content
- use the CMS as the main content source

For a normal company or product website, this setup is already very useful.

## Simple Final Summary

This CMS is a built-in headless content system for Exargen Command Center.

It allows your team to:

- create website content
- manage blogs
- reuse templates
- upload media
- publish content for external websites

The simple understanding is:

- your team writes content in the CMS
- the CMS stores and manages it
- your website reads that content and displays it

So if someone asks, “How is this CMS implemented and how does it integrate with websites?”, the simplest answer is:

This CMS is a project-based, blog-focused headless CMS inside Exargen Command Center. It stores content, media, templates, and SEO data, then provides published content to websites so they can display it without hardcoding content into the website itself.
