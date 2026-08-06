#!/usr/bin/env python3
"""Convert `import { Icon } from 'lucide-react'` to individual icon path imports.

Example:
  Before: import { Search, AlertTriangle } from 'lucide-react';
  After:  import Search from 'lucide-react/dist/esm/icons/search';
          import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
"""

import re
import os
import glob

def pascal_to_kebab(name: str) -> str:
    """Convert PascalCase icon name to kebab-case file path.
    
    Examples:
      Search       -> search
      AlertTriangle -> alert-triangle
      CheckCircle2  -> check-circle-2
      Building2     -> building-2
      PackageX      -> package-x
      PhoneCall     -> phone-call
    """
    # Insert hyphens before uppercase letters (that follow lowercase)
    result = re.sub(r'([a-z])([A-Z])', r'\1-\2', name)
    # Insert hyphens between consecutive uppercase letters followed by lowercase
    result = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1-\2', result)
    # Insert hyphen before trailing digits (e.g., Building2 -> Building-2)
    result = re.sub(r'([a-zA-Z])(\d)', r'\1-\2', result)
    return result.lower()

def process_file(filepath: str) -> bool:
    """Process a single file, converting lucide-react imports.
    
    Returns True if file was modified.
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Match import statements from lucide-react
    # Handles both single-line and multi-line imports
    pattern = r'import\s*\{([^}]+)\}\s*from\s*[\'"]lucide-react[\'"]\s*;?'
    
    def replace_import(match):
        icons_str = match.group(1)
        # Split by comma and clean up
        icon_names = [name.strip() for name in icons_str.split(',') if name.strip()]
        
        individual_imports = []
        for name in icon_names:
            kebab = pascal_to_kebab(name)
            individual_imports.append(f"import {name} from 'lucide-react/dist/esm/icons/{kebab}'")
        
        return '\n'.join(individual_imports)
    
    new_content = re.sub(pattern, replace_import, content)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

def main():
    src_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
    
    # Find all .ts and .tsx files
    patterns = [
        os.path.join(src_dir, '**', '*.ts'),
        os.path.join(src_dir, '**', '*.tsx'),
    ]
    
    modified_files = []
    for pattern in patterns:
        for filepath in glob.glob(pattern, recursive=True):
            if process_file(filepath):
                modified_files.append(filepath)
    
    if modified_files:
        print(f"SUCCESS: Modified {len(modified_files)} file(s):")
        for f in modified_files:
            print(f"  - {os.path.relpath(f, os.path.dirname(src_dir))}")
    else:
        print("No files were modified.")

if __name__ == '__main__':
    main()
