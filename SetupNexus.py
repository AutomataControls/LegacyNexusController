#!/usr/bin/env python3
"""
AutomataControls™ Tunnel Setup GUI
Node.js Portal & Cloudflare Tunnel Configuration
Copyright © 2024 AutomataNexus, LLC. All rights reserved.

PROPRIETARY AND CONFIDENTIAL
This software is proprietary to AutomataNexus and constitutes valuable 
trade secrets. This software may not be copied, distributed, modified, 
or disclosed to third parties without prior written authorization from 
AutomataNexus. Use of this software is governed by a commercial license
agreement. Unauthorized use is strictly prohibited.

AutomataNexusBms Controller Software
Version: 2.1.0
"""

import subprocess
import sys
import os
import json
import time
import random
import base64
import threading
import queue
from datetime import datetime

# Install required packages before importing them
def install_dependencies():
    """Install required GUI dependencies"""
    print("Checking and installing GUI dependencies...")
    
    packages = [
        "python3-tk",
        "python3-pil", 
        "python3-pil.imagetk"
    ]
    
    for package in packages:
        print(f"Installing {package}...")
        subprocess.run(
            ["sudo", "apt-get", "install", "-y", package],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    
    print("Dependencies installed!")

# Only install if running as main
if __name__ == "__main__":
    # Check if we need to install dependencies
    try:
        import tkinter as tk
        from tkinter import ttk, scrolledtext, messagebox
        from PIL import Image, ImageTk
    except ImportError:
        print("GUI dependencies not found. Installing...")
        install_dependencies()
        
        # Try importing again
        try:
            import tkinter as tk
            from tkinter import ttk, scrolledtext, messagebox
            from PIL import Image, ImageTk
        except ImportError as e:
            print(f"Error: Failed to install dependencies: {e}")
            print("Please run manually: sudo apt-get install python3-tk python3-pil python3-pil.imagetk")
            sys.exit(1)

# Neural Nexus Color Scheme - Light Theme
COLORS = {
    'bg_primary': '#ffffff',
    'bg_secondary': '#f8f9fa',
    'bg_tertiary': '#e9ecef',
    'bg_card': '#ffffff',
    'accent_primary': '#06b6d4',
    'accent_secondary': '#0891b2',
    'accent_light': '#22d3ee',
    'text_primary': '#212529',
    'text_secondary': '#495057',
    'text_tertiary': '#6c757d',
    'success': '#10b981',
    'warning': '#f59e0b',
    'error': '#ef4444',
    'border': '#dee2e6'
}

# API Keys (encoded for security)
API_KEYS = {
    'CLOUDFLARE_API': 'yYYuY2_JrPG-Cyepidg582kYWfhAdWPu-ertr1fM',
    'RESEND_API': 're_cQM9wxDs_4ELeERKQ4yAGDEHc9wiTqHUp',
    'OPENWEATHER_API': '03227bcaf87f9da3005635805ed1b56e',
    'API_AUTH_KEY': 'Wh7CvyocBYc2KH3WLIOzFV5j_oHt-9TCiI0CpMFukdQ',
    'JWT_SECRET': 'Ev1Bf8Gz8JEQl0PLRzNiyRzvkoDf1OXIWgFNykK2maw',
    'SESSION_SECRET': 'LCJST-eccEqVSIyrEuO7uLT5AJtyHYgF-Sdyhchtsy8'
}

class TunnelInstallerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("AutomataControls™ Tunnel Setup")
        
        # Get screen dimensions
        screen_width = root.winfo_screenwidth()
        screen_height = root.winfo_screenheight()

        # Set window size to 90% of screen or max 900x700 (whichever is smaller)
        window_width = min(900, int(screen_width * 0.9))
        window_height = min(700, int(screen_height * 0.85))

        # Center the window
        x = (screen_width - window_width) // 2
        y = (screen_height - window_height) // 2

        self.root.geometry(f'{window_width}x{window_height}+{x}+{y}')
        self.root.configure(bg=COLORS['bg_primary'])

        # Make window resizable
        self.root.resizable(True, True)

        # Set minimum size to ensure buttons are visible
        self.root.minsize(800, 600)
        
        # Queue for thread communication
        self.queue = queue.Queue()
        
        # Installation state
        self.is_installing = False
        self.controller_serial = None
        self.tunnel_domain = None
        self.install_claude_code = tk.BooleanVar(value=False)
        
        # Encoded Cloudflare API for tunnel creation
        self.encoded_api = base64.b64encode(API_KEYS['CLOUDFLARE_API'].encode()).decode()
        
        self.create_main_interface()
        self.check_queue()
    
    def create_main_interface(self):
        """Create the main interface with Neural Nexus styling"""
        # Main container with gradient effect
        main_container = tk.Frame(self.root, bg=COLORS['bg_primary'])
        main_container.pack(fill=tk.BOTH, expand=True)
        
        # Header with logo
        header_frame = tk.Frame(main_container, bg=COLORS['bg_secondary'], height=100)
        header_frame.pack(fill=tk.X)
        header_frame.pack_propagate(False)
        
        # Try to load logo
        logo_label = None
        try:
            logo_path = os.path.join(os.path.dirname(__file__), 'remote-access-portal', 'public', 'automata-nexus-logo.png')
            if os.path.exists(logo_path):
                logo_img = Image.open(logo_path)
                logo_img = logo_img.resize((60, 60), Image.LANCZOS)
                logo_photo = ImageTk.PhotoImage(logo_img)
                logo_label = tk.Label(header_frame, image=logo_photo, bg=COLORS['bg_secondary'])
                logo_label.image = logo_photo
                logo_label.pack(side=tk.LEFT, padx=30, pady=20)
        except:
            pass
        
        # Title section - CENTERED
        title_frame = tk.Frame(header_frame, bg=COLORS['bg_secondary'])
        title_frame.pack(fill=tk.BOTH, expand=True)
        
        title_label = tk.Label(
            title_frame,
            text="AutomataControls™ Remote Portal Setup",
            font=('Inter', 24, 'bold'),
            fg=COLORS['accent_primary'],
            bg=COLORS['bg_secondary']
        )
        title_label.pack(pady=(25, 5))  # Centered
        
        subtitle_label = tk.Label(
            title_frame,
            text="AutomataNexusBms Controller Configuration",
            font=('Inter', 12),
            fg=COLORS['text_secondary'],
            bg=COLORS['bg_secondary']
        )
        subtitle_label.pack()  # Centered
        
        # Create a canvas with scrollbar for content
        canvas_frame = tk.Frame(main_container, bg=COLORS['bg_primary'])
        canvas_frame.pack(fill=tk.BOTH, expand=True, padx=30, pady=20)

        # Create canvas
        canvas = tk.Canvas(canvas_frame, bg=COLORS['bg_primary'], highlightthickness=0)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Add scrollbar
        scrollbar = tk.Scrollbar(canvas_frame, orient=tk.VERTICAL, command=canvas.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.configure(yscrollcommand=scrollbar.set)

        # Create scrollable frame
        content_frame = tk.Frame(canvas, bg=COLORS['bg_primary'])
        canvas_window = canvas.create_window(0, 0, anchor=tk.NW, window=content_frame)

        # Configure canvas scrolling
        def configure_scroll(event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))
            # Make the frame expand to fill the canvas width
            canvas_width = canvas.winfo_width()
            if canvas_width > 1:
                canvas.itemconfig(canvas_window, width=canvas_width)

        content_frame.bind('<Configure>', configure_scroll)
        canvas.bind('<Configure>', lambda e: canvas.itemconfig(canvas_window, width=e.width))

        # Enable mousewheel scrolling
        def on_mousewheel(event):
            canvas.yview_scroll(int(-1*(event.delta/120)), "units")

        canvas.bind_all("<MouseWheel>", on_mousewheel)

        # Left column - Configuration inputs
        left_frame = tk.Frame(content_frame, bg=COLORS['bg_card'])
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 15))
        
        # LICENSE FRAME - MUST BE FIRST
        license_frame = tk.Frame(left_frame, bg=COLORS['bg_secondary'], relief=tk.RAISED, bd=1)
        license_frame.pack(fill=tk.X, padx=15, pady=(15, 15))
        
        license_title = tk.Label(
            license_frame,
            text="AutomataControls™ - Commercial License",
            font=('Inter', 12, 'bold'),
            fg=COLORS['accent_primary'],
            bg=COLORS['bg_secondary']
        )
        license_title.pack(pady=(10, 5))
        
        license_text = tk.Label(
            license_frame,
            text="© 2024 AutomataNexus, LLC. All Rights Reserved.\n"
                 "Commercial License Required - Not Open Source\n"
                 "⚠️ UNAUTHORIZED USE PROHIBITED - Contains Trade Secrets",
            font=('Inter', 9),
            fg=COLORS['text_primary'],
            bg=COLORS['bg_secondary'],
            justify=tk.CENTER
        )
        license_text.pack(pady=(0, 5))

        # Add clickable "View Full License" link
        license_link = tk.Label(
            license_frame,
            text="[ View Full License Agreement ]",
            font=('Inter', 9, 'underline'),
            fg=COLORS['accent_primary'],
            bg=COLORS['bg_secondary'],
            cursor='hand2'
        )
        license_link.pack(pady=(0, 5))
        license_link.bind('<Button-1>', lambda e: self.show_license_modal())
        
        # Accept license checkbox
        self.license_var = tk.BooleanVar()
        self.license_check = tk.Checkbutton(
            license_frame,
            text="I accept the commercial license agreement and have a valid license",
            variable=self.license_var,
            font=('Inter', 10, 'bold'),
            fg=COLORS['text_primary'],
            bg=COLORS['bg_secondary'],
            selectcolor='white',
            activebackground=COLORS['bg_secondary'],
            command=self.check_license
        )
        self.license_check.pack(pady=(0, 10))
        
        # Configuration header
        config_header = tk.Frame(left_frame, bg=COLORS['bg_tertiary'])
        config_header.pack(fill=tk.X)
        
        config_label = tk.Label(
            config_header,
            text="CONTROLLER CONFIGURATION",
            font=('Inter', 11, 'bold'),
            fg=COLORS['accent_primary'],
            bg=COLORS['bg_tertiary']
        )
        config_label.pack(anchor=tk.W, padx=20, pady=15)
        
        # Input fields container
        inputs_frame = tk.Frame(left_frame, bg=COLORS['bg_card'])
        inputs_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
        
        # Location input (REQUIRED)
        self.create_input_field(inputs_frame, "Installation Location *", "location",
                              "e.g., Building A - Floor 2, Chicago, IL")
        
        # Equipment ID input (OPTIONAL)
        self.create_input_field(inputs_frame, "Equipment ID (Optional)", "equipment",
                              "Leave blank if not using BMS integration")
        
        # Weather location input - ZIP CODE
        self.create_input_field(inputs_frame, "Weather Location (ZIP Code) *", "weather",
                              "e.g., 60601")
        
        # Port configuration
        self.create_input_field(inputs_frame, "Web Portal Port", "port",
                              "Default: 8000")
        
        # Claude Code checkbox (OPTIONAL)
        claude_frame = tk.Frame(inputs_frame, bg=COLORS['bg_card'])
        claude_frame.pack(fill=tk.X, pady=(20, 0))
        
        claude_check = tk.Checkbutton(
            claude_frame,
            text="Install Claude Code CLI (optional - for AI development assistance)",
            variable=self.install_claude_code,
            font=('Inter', 10),
            fg=COLORS['text_secondary'],
            bg=COLORS['bg_card'],
            selectcolor='white',
            activebackground=COLORS['bg_card']
        )
        claude_check.pack(anchor=tk.W)
        
        # Note: Buttons will be added at the bottom of the window, not here
        
        # Right column - Console output
        right_frame = tk.Frame(content_frame, bg=COLORS['bg_card'])
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(15, 0))
        
        # Console header
        console_header = tk.Frame(right_frame, bg=COLORS['bg_tertiary'])
        console_header.pack(fill=tk.X)
        
        console_label = tk.Label(
            console_header,
            text="INSTALLATION CONSOLE",
            font=('Inter', 11, 'bold'),
            fg=COLORS['accent_light'],
            bg=COLORS['bg_tertiary']
        )
        console_label.pack(anchor=tk.W, padx=20, pady=15)
        
        # Progress section
        progress_frame = tk.Frame(right_frame, bg=COLORS['bg_card'])
        progress_frame.pack(fill=tk.X, padx=20, pady=(20, 10))
        
        self.progress_label = tk.Label(
            progress_frame,
            text="Ready to install...",
            font=('Inter', 10),
            fg=COLORS['text_secondary'],
            bg=COLORS['bg_card']
        )
        self.progress_label.pack(anchor=tk.W)
        
        # Custom progress bar
        self.progress_canvas = tk.Canvas(
            progress_frame,
            height=30,
            bg=COLORS['bg_tertiary'],
            highlightthickness=0
        )
        self.progress_canvas.pack(fill=tk.X, pady=(5, 0))
        
        # Progress bar fill
        self.progress_fill = self.progress_canvas.create_rectangle(
            0, 0, 0, 30,
            fill=COLORS['accent_primary'],
            width=0
        )
        
        # Progress text
        self.progress_text = self.progress_canvas.create_text(
            10, 15,
            text="0%",
            fill=COLORS['text_primary'],
            font=('Inter', 10, 'bold'),
            anchor='w'
        )
        
        # Console output
        console_frame = tk.Frame(right_frame, bg=COLORS['bg_primary'])
        console_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=(10, 20))
        
        self.console = scrolledtext.ScrolledText(
            console_frame,
            font=('Courier', 9),
            bg='white',
            fg=COLORS['text_primary'],
            insertbackground=COLORS['accent_primary'],
            wrap=tk.WORD,
            bd=1,
            relief=tk.SUNKEN
        )
        self.console.pack(fill=tk.BOTH, expand=True)
        
        # Button bar at bottom (above footer)
        button_bar = tk.Frame(main_container, bg=COLORS['bg_tertiary'], height=70)
        button_bar.pack(fill=tk.X, side=tk.BOTTOM)
        button_bar.pack_propagate(False)

        # Button container with padding
        button_container = tk.Frame(button_bar, bg=COLORS['bg_tertiary'])
        button_container.pack(expand=True)

        # Exit button on LEFT
        exit_btn = tk.Button(
            button_container,
            text="Exit",
            font=('Inter', 11),
            bg='white',
            fg=COLORS['text_primary'],
            activebackground=COLORS['bg_secondary'],
            activeforeground=COLORS['text_primary'],
            command=self.root.quit,
            padx=25,
            pady=10,
            relief=tk.RAISED,
            bd=2
        )
        exit_btn.pack(side=tk.LEFT, padx=20, pady=15)

        # Install button on RIGHT (disabled until license accepted)
        self.install_btn = tk.Button(
            button_container,
            text="Install",
            font=('Inter', 11, 'bold'),
            bg=COLORS['accent_primary'],
            fg='white',
            activebackground=COLORS['accent_secondary'],
            activeforeground='white',
            command=self.start_installation,
            state=tk.DISABLED,
            padx=30,
            pady=10,
            relief=tk.RAISED,
            bd=2
        )
        self.install_btn.pack(side=tk.RIGHT, padx=20, pady=15)

        # Cancel button next to Install
        self.cancel_btn = tk.Button(
            button_container,
            text="Cancel",
            font=('Inter', 11),
            bg='white',
            fg=COLORS['text_primary'],
            activebackground=COLORS['bg_secondary'],
            activeforeground=COLORS['text_primary'],
            command=self.cancel_installation,
            state=tk.DISABLED,
            padx=25,
            pady=10,
            relief=tk.RAISED,
            bd=2
        )
        self.cancel_btn.pack(side=tk.RIGHT, padx=5, pady=15)

        # Footer
        footer_frame = tk.Frame(main_container, bg=COLORS['bg_secondary'], height=50)
        footer_frame.pack(fill=tk.X, side=tk.BOTTOM)
        footer_frame.pack_propagate(False)
        
        footer_label = tk.Label(
            footer_frame,
            text="© 2024 AutomataNexus, LLC. All rights reserved. | Commercial License Required",
            font=('Inter', 9),
            fg=COLORS['text_tertiary'],
            bg=COLORS['bg_secondary']
        )
        footer_label.pack(expand=True)
    
    def create_input_field(self, parent, label_text, field_name, placeholder=""):
        """Create a styled input field"""
        frame = tk.Frame(parent, bg=COLORS['bg_card'])
        frame.pack(fill=tk.X, pady=(0, 15))
        
        label = tk.Label(
            frame,
            text=label_text,
            font=('Inter', 10),
            fg=COLORS['text_secondary'],
            bg=COLORS['bg_card']
        )
        label.pack(anchor=tk.W)
        
        entry = tk.Entry(
            frame,
            font=('Inter', 11),
            bg=COLORS['bg_tertiary'],
            fg=COLORS['text_primary'],
            insertbackground=COLORS['accent_primary'],
            bd=1,
            relief=tk.FLAT
        )
        entry.pack(fill=tk.X, pady=(5, 0), ipady=8)
        
        # Add placeholder
        if placeholder:
            entry.insert(0, placeholder)
            entry.config(fg=COLORS['text_tertiary'])
            
            def on_focus_in(event):
                if entry.get() == placeholder:
                    entry.delete(0, tk.END)
                    entry.config(fg=COLORS['text_primary'])
            
            def on_focus_out(event):
                if not entry.get():
                    entry.insert(0, placeholder)
                    entry.config(fg=COLORS['text_tertiary'])
            
            entry.bind('<FocusIn>', on_focus_in)
            entry.bind('<FocusOut>', on_focus_out)
        
        # Store reference to entry widget
        setattr(self, f"{field_name}_entry", entry)
    
    def check_license(self):
        """Enable/disable install button based on license acceptance"""
        if self.license_var.get():
            self.install_btn.config(state=tk.NORMAL, bg=COLORS['accent_primary'], fg='white')
        else:
            self.install_btn.config(state=tk.DISABLED, bg=COLORS['bg_tertiary'], fg=COLORS['text_primary'])

    def show_license_modal(self):
        """Display the full license agreement in a modal window"""
        # Create modal window
        modal = tk.Toplevel(self.root)
        modal.title("AutomataControls™ Commercial License Agreement")
        modal.configure(bg=COLORS['bg_primary'])

        # Center the modal
        modal_width = 800
        modal_height = 600
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = (screen_width - modal_width) // 2
        y = (screen_height - modal_height) // 2
        modal.geometry(f'{modal_width}x{modal_height}+{x}+{y}')

        # Make modal stay on top
        modal.transient(self.root)
        modal.grab_set()

        # Header
        header_frame = tk.Frame(modal, bg=COLORS['bg_secondary'], height=60)
        header_frame.pack(fill=tk.X)
        header_frame.pack_propagate(False)

        title_label = tk.Label(
            header_frame,
            text="COMMERCIAL SOFTWARE LICENSE AGREEMENT",
            font=('Inter', 14, 'bold'),
            fg=COLORS['accent_primary'],
            bg=COLORS['bg_secondary']
        )
        title_label.pack(pady=15)

        # License text in scrollable area
        text_frame = tk.Frame(modal, bg=COLORS['bg_primary'])
        text_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)

        # Use scrolledtext which combines text widget and scrollbar
        license_text = scrolledtext.ScrolledText(
            text_frame,
            font=('Courier', 10),
            bg='white',
            fg='black',  # Explicitly set to black
            wrap=tk.WORD,
            bd=2,
            relief=tk.SUNKEN,
            padx=10,
            pady=10,
            height=20,
            width=80
        )
        license_text.pack(fill=tk.BOTH, expand=True)

        # Insert the full license agreement
        full_license = """AUTOMATACONTROLS™ COMMERCIAL SOFTWARE LICENSE AGREEMENT

IMPORTANT: READ CAREFULLY BEFORE USING THIS SOFTWARE

This Commercial Software License Agreement ("Agreement") is a legal agreement between you (either an individual or a single entity) and AutomataNexus, LLC ("Licensor") for the AutomataNexusBms Controller software, including any associated media, printed materials, and electronic documentation (collectively, the "Software").

BY INSTALLING, COPYING, OR OTHERWISE USING THE SOFTWARE, YOU AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT.

1. PROPRIETARY RIGHTS
The Software is proprietary to AutomataNexus, LLC and constitutes valuable trade secrets. The Software is protected by copyright laws, international copyright treaties, and other intellectual property laws and treaties. The Software is licensed, not sold.

2. GRANT OF LICENSE
Subject to the terms and conditions of this Agreement and payment of applicable license fees, Licensor grants you a non-exclusive, non-transferable license to:
a) Install and use the Software on a single controller device
b) Make one backup copy for archival purposes only

3. LICENSE RESTRICTIONS
You may NOT:
a) Copy, distribute, or disclose the Software to third parties
b) Modify, adapt, translate, reverse engineer, decompile, or disassemble the Software
c) Create derivative works based on the Software
d) Remove any proprietary notices or labels from the Software
e) Use the Software for any unlawful purpose
f) Sublicense, rent, lease, or lend the Software
g) Use the Software in a service bureau or time-sharing arrangement

4. UNAUTHORIZED USE
ANY UNAUTHORIZED USE, COPYING, OR DISTRIBUTION OF THIS SOFTWARE IS STRICTLY PROHIBITED AND WILL RESULT IN IMMEDIATE TERMINATION OF THIS LICENSE AND MAY SUBJECT YOU TO CIVIL AND CRIMINAL PENALTIES.

5. TRADE SECRETS
You acknowledge that the Software contains trade secrets and proprietary information of AutomataNexus, LLC. You agree to maintain the confidentiality of such information and not disclose it to any third party.

6. OWNERSHIP
AutomataNexus, LLC retains all right, title, and interest in and to the Software, including all intellectual property rights. This Agreement does not transfer any ownership rights to you.

7. TERM AND TERMINATION
This license is effective until terminated. Your rights under this license will terminate automatically without notice if you fail to comply with any term of this Agreement. Upon termination, you must destroy all copies of the Software in your possession.

8. WARRANTY DISCLAIMER
THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

9. LIMITATION OF LIABILITY
IN NO EVENT SHALL AUTOMATA NEXUS, LLC BE LIABLE FOR ANY SPECIAL, INCIDENTAL, INDIRECT, OR CONSEQUENTIAL DAMAGES WHATSOEVER ARISING OUT OF THE USE OF OR INABILITY TO USE THE SOFTWARE.

10. EXPORT RESTRICTIONS
You agree to comply with all applicable export and re-export control laws and regulations, including the Export Administration Regulations of the U.S. Department of Commerce.

11. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Delaware, USA, without regard to its conflict of law provisions.

12. ENTIRE AGREEMENT
This Agreement constitutes the entire agreement between the parties and supersedes all prior or contemporaneous agreements or representations, written or oral, concerning the Software.

13. COMMERCIAL LICENSE REQUIRED
This Software requires a valid commercial license for production use. Contact AutomataNexus, LLC for licensing information:
- Email: licensing@automatacontrols.com
- Phone: 1-888-AUTOMATA

14. AUDIT RIGHTS
AutomataNexus, LLC reserves the right to audit your use of the Software to ensure compliance with this Agreement.

15. INJUNCTIVE RELIEF
You acknowledge that breach of this Agreement would cause irreparable harm to AutomataNexus, LLC for which monetary damages would be inadequate, and agree that AutomataNexus, LLC shall be entitled to seek injunctive relief.

© 2024 AutomataNexus, LLC. All Rights Reserved.
AutomataControls™ and AutomataNexusBms™ are trademarks of AutomataNexus, LLC.

Version 2.1.0 - Last Updated: November 2024"""

        # Insert license text
        license_text.delete('1.0', tk.END)  # Clear any existing text
        license_text.insert('1.0', full_license)

        # Scroll to top
        license_text.see('1.0')

        # Make read-only after inserting
        license_text.config(state='disabled')

        # Button frame
        button_frame = tk.Frame(modal, bg=COLORS['bg_primary'])
        button_frame.pack(fill=tk.X, padx=20, pady=10)

        # Close button
        close_btn = tk.Button(
            button_frame,
            text="Close",
            font=('Inter', 11),
            bg=COLORS['bg_tertiary'],
            fg=COLORS['text_primary'],
            activebackground=COLORS['bg_secondary'],
            activeforeground=COLORS['text_primary'],
            command=modal.destroy,
            padx=30,
            pady=8,
            relief=tk.RAISED,
            bd=2
        )
        close_btn.pack(side=tk.RIGHT)

        # X button in corner
        modal.protocol("WM_DELETE_WINDOW", modal.destroy)
    
    def update_progress(self, percent, message=""):
        """Update progress bar and label"""
        self.progress_label.config(text=message)
        
        # Update progress bar fill
        canvas_width = self.progress_canvas.winfo_width()
        if canvas_width > 1:
            fill_width = int(canvas_width * percent / 100)
            self.progress_canvas.coords(self.progress_fill, 0, 0, fill_width, 30)
            # Update text
            self.progress_canvas.itemconfig(self.progress_text, text=f"{percent}%")
    
    def start_installation(self):
        """Start the installation process"""
        if self.is_installing:
            return
        
        # Validate required fields
        location = self.location_entry.get().strip()
        weather = self.weather_entry.get().strip()
        
        # Remove placeholder text if present
        if location in ["", "e.g., Building A - Floor 2, Chicago, IL"]:
            messagebox.showerror("Error", "Please enter the installation location")
            return
        
        if weather in ["", "e.g., 60601"] or not weather.isdigit() or len(weather) != 5:
            messagebox.showerror("Error", "Please enter a valid 5-digit ZIP code")
            return
        
        self.is_installing = True
        self.install_btn.config(state='disabled')
        self.cancel_btn.config(state='normal')
        
        # Clear console
        self.console.delete(1.0, tk.END)
        self.console.insert(tk.END, "Starting AutomataNexusBms Controller setup...\n\n")
        
        # Start installation in separate thread
        install_thread = threading.Thread(target=self.run_installation)
        install_thread.daemon = True
        install_thread.start()
    
    def run_installation(self):
        """Run the installation process"""
        try:
            # Decode API key
            api_key = API_KEYS['CLOUDFLARE_API']
            
            # Get user inputs
            location = self.location_entry.get().strip()
            equipment = self.equipment_entry.get().strip()
            weather = self.weather_entry.get().strip()
            port = self.port_entry.get().strip()
            
            # Remove placeholders and set defaults
            if equipment == "Leave blank if not using BMS integration":
                equipment = ""
            
            if port in ["", "Default: 8000"]:
                port = "8000"
            
            # Get user
            user = os.environ.get('SUDO_USER', 'pi')
            if not user:
                user = 'Automata'
            
            # STEP 1: Clean up previous installations
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 1: CLEANING UP PREVIOUS INSTALLATIONS\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (5, 'Cleaning up...')))
            
            # Stop services
            self.queue.put(('console', 'Stopping services...\n'))
            subprocess.run(['sudo', 'systemctl', 'stop', 'cloudflared'], capture_output=True)
            subprocess.run(['sudo', 'systemctl', 'disable', 'cloudflared'], capture_output=True)
            # Try to kill PM2 if it exists, otherwise just kill node processes
            pm2_check = subprocess.run(['which', 'pm2'], capture_output=True)
            if pm2_check.returncode == 0:
                subprocess.run(['pm2', 'kill'], capture_output=True)
            else:
                subprocess.run(['sudo', 'killall', 'node'], capture_output=True)
            
            # Remove old files and directories
            self.queue.put(('console', 'Removing old configuration files...\n'))
            subprocess.run(['sudo', 'rm', '-rf', f'/home/{user}/.cloudflared'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-f', f'/home/{user}/.env'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-f', '/etc/systemd/system/cloudflared.service'], capture_output=True)

            # Check if we're running from the portal directory
            portal_dest = f'/home/{user}/remote-access-portal'
            installer_dir = os.path.dirname(os.path.abspath(__file__))

            # Only clean portal contents if we're running from inside it, don't remove the whole dir
            if installer_dir == portal_dest or installer_dir.endswith('/remote-access-portal'):
                self.queue.put(('console', 'Cleaning portal directory contents (keeping installer)...\n'))
                # Clean only build artifacts and node_modules, not the whole directory
                subprocess.run(['sudo', 'rm', '-rf', f'{portal_dest}/node_modules'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-rf', f'{portal_dest}/.next'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-rf', f'{portal_dest}/build'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-rf', f'{portal_dest}/dist'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-f', f'{portal_dest}/package-lock.json'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-rf', f'{portal_dest}/data'], capture_output=True)
                subprocess.run(['sudo', 'rm', '-f', f'{portal_dest}/.env'], capture_output=True)
                self.queue.put(('console', '✓ Portal directory cleaned\n'))
            elif os.path.exists(portal_dest):
                # Only remove if we're NOT running from inside it
                self.queue.put(('console', 'Removing old portal directory...\n'))
                subprocess.run(['sudo', 'rm', '-rf', portal_dest], capture_output=True)
                self.queue.put(('console', '✓ Old portal directory removed\n'))
            
            self.queue.put(('console', '✓ Cleanup complete\n\n'))
            time.sleep(1)
            
            # STEP 2: Generate serial number
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 2: GENERATING CONTROLLER SERIAL NUMBER\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (10, 'Generating serial number...')))
            
            # Generate random 6-character hex suffix (lowercase)
            random_suffix = ''.join(random.choice('0123456789abcdef') for _ in range(6))
            self.controller_serial = f"nexuscontroller-anc-{random_suffix}"
            tunnel_name = self.controller_serial
            self.tunnel_domain = f"{tunnel_name}.automatacontrols.com"
            
            self.queue.put(('console', f'✓ Controller Serial: {self.controller_serial}\n'))
            self.queue.put(('console', f'✓ Tunnel Domain: {self.tunnel_domain}\n\n'))
            time.sleep(1)
            
            # STEP 3: Install system dependencies  
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 3: INSTALLING SYSTEM DEPENDENCIES\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (15, 'Installing system packages...')))
            
            # Install required system packages
            self.queue.put(('console', 'Installing build tools and libraries...\n'))
            subprocess.run(['sudo', 'apt-get', 'update'], capture_output=True)
            subprocess.run(['sudo', 'apt-get', 'install', '-y', 
                           'build-essential', 'python3', 'python3-pip', 
                           'wget', 'curl', 'git'], capture_output=True)
            
            # Install Python requests and yaml for API calls and config parsing
            subprocess.run(['sudo', 'pip3', 'install', 'requests', 'pyyaml'], capture_output=True)
            
            # Check Node.js installation - DO NOT INSTALL/CHANGE IT
            node_check = subprocess.run(['which', 'node'], capture_output=True)
            if not node_check.stdout:
                self.queue.put(('console', '⚠️ Node.js not found - will use system default if available\n'))
            
            self.queue.put(('console', '✓ System dependencies installed\n\n'))

            # STEP 3.5: Install Sequent Microsystems hardware control libraries
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 3.5: INSTALLING HARDWARE LIBRARIES\n'))
            self.queue.put(('console', '═══════════════════════════════════\n\n'))
            self.queue.put(('progress', (20, 'Installing hardware control libraries...')))

            # Check and enable I2C interface if needed
            self.queue.put(('console', 'Checking I2C interface...\n'))
            i2c_check = subprocess.run(['sudo', 'raspi-config', 'nonint', 'get_i2c'],
                                      capture_output=True, text=True)
            if i2c_check.stdout.strip() == '0':
                self.queue.put(('console', '  ✓ I2C already enabled\n'))
            else:
                self.queue.put(('console', '  Enabling I2C interface...\n'))
                subprocess.run(['sudo', 'raspi-config', 'nonint', 'do_i2c', '0'], capture_output=True)
                self.queue.put(('console', '  ✓ I2C enabled\n'))

            # Check if i2c-tools already installed
            self.queue.put(('console', 'Checking I2C tools...\n'))
            i2c_tools_check = subprocess.run(['which', 'i2cdetect'], capture_output=True)
            if i2c_tools_check.returncode == 0:
                self.queue.put(('console', '  ✓ I2C tools already installed\n'))
            else:
                self.queue.put(('console', '  Installing I2C tools...\n'))
                subprocess.run(['sudo', 'apt-get', 'install', '-y', 'i2c-tools'], capture_output=True)
                self.queue.put(('console', '  ✓ I2C tools installed\n'))

            # Install Sequent Microsystems CLI tools from GitHub
            sm_repos = [
                ('megabas-rpi', 'https://github.com/SequentMicrosystems/megabas-rpi.git'),
                ('16relind-rpi', 'https://github.com/SequentMicrosystems/16relind-rpi.git'),
                ('16univin-rpi', 'https://github.com/SequentMicrosystems/16univin-rpi.git'),
                ('16uout-rpi', 'https://github.com/SequentMicrosystems/16uout-rpi.git'),
                ('8relind-rpi', 'https://github.com/SequentMicrosystems/8relind-rpi.git')
            ]

            # Change to Automata home directory for cloning
            automata_home = '/home/Automata'
            original_dir = os.getcwd()
            os.chdir(automata_home)

            for repo_name, repo_url in sm_repos:
                repo_path = os.path.join(automata_home, repo_name)

                # Get the CLI tool name (remove -rpi suffix)
                tool_name = repo_name.replace('-rpi', '')

                # Check if CLI tool is already installed
                tool_check = subprocess.run(['which', tool_name], capture_output=True)
                if tool_check.returncode == 0:
                    self.queue.put(('console', f'  ✓ {tool_name} already installed (skipping)\n'))
                    continue  # Skip to next tool

                if os.path.exists(repo_path):
                    # Repository exists, pull latest changes
                    self.queue.put(('console', f'Updating {repo_name} repository...\n'))
                    subprocess.run(['git', 'pull'], cwd=repo_path, capture_output=True)
                else:
                    # Clone the repository
                    self.queue.put(('console', f'Cloning {repo_name}...\n'))
                    clone_result = subprocess.run(['git', 'clone', repo_url],
                                                capture_output=True, text=True)
                    if clone_result.returncode != 0:
                        self.queue.put(('console', f'  ⚠️ Clone warning: {clone_result.stderr}\n'))

                # Run make install only if tool not already installed
                if os.path.exists(repo_path):
                    self.queue.put(('console', f'  Installing {tool_name}...\n'))
                    make_result = subprocess.run(['sudo', 'make', 'install'],
                                               cwd=repo_path, capture_output=True, text=True)
                    if make_result.returncode == 0:
                        self.queue.put(('console', f'  ✓ {tool_name} installed\n'))
                    else:
                        self.queue.put(('console', f'  ⚠️ Make install warning: {make_result.stderr}\n'))

            # Change back to original directory
            os.chdir(original_dir)

            # Install Python packages
            self.queue.put(('console', '\nInstalling Python packages...\n'))
            sm_packages = [
                'SMmegabas',      # MegaBAS controller
                'SM16univin',     # 16 Universal inputs
                'SM16relind',     # 16 Relays
                'SM16uout',       # 16 0-10V outputs
                'SM8relind'       # 8 Relays
            ]

            for package in sm_packages:
                # Check if package is already installed
                pkg_check = subprocess.run(['pip3', 'show', package],
                                          capture_output=True, text=True)
                if pkg_check.returncode == 0:
                    self.queue.put(('console', f'  ✓ {package} already installed (skipping)\n'))
                    continue  # Skip to next package

                self.queue.put(('console', f'  Installing {package}...\n'))
                result = subprocess.run(['sudo', 'pip3', 'install', package],
                                      capture_output=True, text=True)
                if result.returncode == 0:
                    self.queue.put(('console', f'    ✓ {package} installed\n'))
                else:
                    self.queue.put(('console', f'    ⚠️ {package} install warning: {result.stderr}\n'))

            self.queue.put(('console', '✓ Hardware control libraries installed\n\n'))

            # STEP 4: Install Node.js dependencies and build React app
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 4: BUILDING REACT APPLICATION\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (25, 'Setting up React application...')))
            
            # The installer is IN the portal directory
            portal_dest = f'/home/{user}/remote-access-portal'

            # Check if we're already in the portal directory
            installer_dir = os.path.dirname(os.path.abspath(__file__))
            if installer_dir == portal_dest or installer_dir.endswith('/remote-access-portal'):
                self.queue.put(('console', f'✓ Using existing portal at {portal_dest}\n'))
                portal_src = installer_dir
            else:
                # Look for portal files in the installer's directory
                portal_src = installer_dir
                if not os.path.exists(os.path.join(portal_src, 'package.json')):
                    self.queue.put(('console', f'⚠️ Warning: Not a valid portal directory at {portal_src}\n'))
                    # Try the destination directory
                    if os.path.exists(os.path.join(portal_dest, 'package.json')):
                        self.queue.put(('console', f'✓ Found existing portal at {portal_dest}\n'))
                        portal_src = portal_dest
                    else:
                        self.queue.put(('console', '❌ Error: Cannot find portal files!\n'))
                        self.queue.put(('console', 'Please run installer from /home/Automata/remote-access-portal directory.\n'))
                        raise Exception('Portal files not found')

            # Only copy if source and dest are different
            if portal_src != portal_dest:
                self.queue.put(('console', f'Copying portal files from {portal_src} to {portal_dest}...\n'))
                subprocess.run(['sudo', 'cp', '-r', portal_src, portal_dest], check=True)

            # Set ownership with full permissions for Automata user
            self.queue.put(('console', f'Setting full ownership to {user}...\n'))
            # Ensure directory exists before chown
            if os.path.exists(portal_dest):
                # Set ownership recursively with sudo
                subprocess.run(['sudo', 'chown', '-R', f'{user}:{user}', portal_dest], check=False)
                # Also set directory permissions to ensure full access
                subprocess.run(['sudo', 'chmod', '-R', '755', portal_dest], check=False)
                # Make sure user can write to all files
                subprocess.run(['sudo', 'find', portal_dest, '-type', 'f', '-exec', 'chmod', '644', '{}', ';'], check=False)
                # Make scripts executable
                subprocess.run(['sudo', 'find', portal_dest, '-name', '*.sh', '-exec', 'chmod', '755', '{}', ';'], check=False)
                self.queue.put(('console', f'✓ Full ownership granted to {user}\n'))
            else:
                self.queue.put(('console', f'⚠️ Portal directory not found at {portal_dest}\n'))
            
            # Change to portal directory
            os.chdir(portal_dest)
            
            # Clean any previous builds
            self.queue.put(('console', 'Cleaning previous builds...\n'))
            subprocess.run(['sudo', 'rm', '-rf', 'node_modules'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-rf', '.next'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-rf', 'build'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-rf', 'dist'], capture_output=True)
            subprocess.run(['sudo', 'rm', '-f', 'package-lock.json'], capture_output=True)
            
            # Install Node.js packages
            self.queue.put(('console', 'Installing dependencies (this may take a few minutes)...\n'))
            # Use full path to npm or run without sudo -u
            npm_path = subprocess.run(['which', 'npm'], capture_output=True, text=True).stdout.strip()
            if npm_path:
                npm_install = subprocess.run(['sudo', '-u', user, npm_path, 'install'],
                                           capture_output=True, text=True, cwd=portal_dest)
            else:
                # Fallback: run npm directly without user switch
                npm_install = subprocess.run(['npm', 'install'],
                                           capture_output=True, text=True, cwd=portal_dest)

            if npm_install.returncode != 0:
                self.queue.put(('console', f'⚠️ npm install warnings: {npm_install.stderr}\n'))
            
            self.queue.put(('console', '✓ Dependencies installed from package.json\n'))
            
            # Build React app with webpack
            self.queue.put(('console', 'Building React application with webpack...\n'))
            if npm_path:
                build_result = subprocess.run(['sudo', '-u', user, npm_path, 'run', 'build'],
                                            capture_output=True, text=True, cwd=portal_dest)
            else:
                build_result = subprocess.run(['npm', 'run', 'build'],
                                            capture_output=True, text=True, cwd=portal_dest)
            
            if build_result.returncode == 0:
                self.queue.put(('console', '✓ React application built successfully\n'))
            else:
                self.queue.put(('console', f'⚠️ Build warnings: {build_result.stderr}\n'))
            
            # Verify build output exists
            if os.path.exists(f'{portal_dest}/public/index.html'):
                self.queue.put(('console', '✓ Build artifacts verified\n\n'))
            else:
                self.queue.put(('console', '⚠️ Build artifacts may be incomplete\n\n'))
            
            # STEP 5: Patch server.js with terminal WebSocket handlers
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 5: PATCHING SERVER WITH TERMINAL SUPPORT\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (28, 'Adding terminal handlers...')))
            
            # Read the server.js file
            server_path = f'{portal_dest}/server.js'
            if os.path.exists(server_path):
                with open(server_path, 'r') as f:
                    server_content = f.read()
                
                # Check if terminal handlers already exist
                if 'terminal-init' not in server_content:
                    # Find where to insert the terminal handlers (before server.listen)
                    insert_pos = server_content.find('// Start server')
                    if insert_pos == -1:
                        insert_pos = server_content.find('server.listen(')
                    
                    if insert_pos > 0:
                        terminal_handlers = """
// Terminal Socket.IO handlers
io.on('connection', (socket) => {
  logger.info('Terminal client connected');
  let ptyProcess = null;

  socket.on('terminal-init', (data) => {
    logger.info('Initializing terminal', data);
    
    // Spawn a new PTY process with clean environment
    ptyProcess = pty.spawn(process.env.SHELL || 'bash', ['--norc', '-i'], {
      name: 'xterm-256color',
      cols: data.cols || 80,
      rows: data.rows || 24,
      cwd: process.env.HOME,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: '\\\\[\\\\033[01;32m\\\\]\\\\u@\\\\h\\\\[\\\\033[00m\\\\]:\\\\[\\\\033[01;34m\\\\]\\\\w\\\\[\\\\033[00m\\\\]\\\\$ '
      }
    });

    // Send PTY output to client
    ptyProcess.onData((data) => {
      socket.emit('terminal-output', data);
    });

    // Handle PTY exit
    ptyProcess.onExit(() => {
      logger.info('Terminal process exited');
      socket.emit('terminal-output', '\\r\\n[Process completed]\\r\\n');
    });
  });

  socket.on('terminal-input', (data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  socket.on('terminal-resize', (data) => {
    if (ptyProcess) {
      ptyProcess.resize(data.cols, data.rows);
    }
  });

  socket.on('disconnect', () => {
    logger.info('Terminal client disconnected');
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
});

"""
                        # Insert the handlers before server.listen
                        server_content = server_content[:insert_pos] + terminal_handlers + server_content[insert_pos:]
                        
                        # Write back the modified server.js
                        with open(server_path, 'w') as f:
                            f.write(server_content)
                        
                        self.queue.put(('console', '✓ Terminal WebSocket handlers added\n'))
                    else:
                        self.queue.put(('console', '⚠️ Could not find insertion point for terminal handlers\n'))
                else:
                    self.queue.put(('console', '✓ Terminal handlers already present\n'))
            else:
                self.queue.put(('console', '⚠️ server.js not found\n'))
            
            self.queue.put(('console', '\n'))
            
            # STEP 6: Generate .env file
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 6: GENERATING CONFIGURATION FILE\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (30, 'Creating configuration...')))

            # Portal destination is ALWAYS /home/Automata/remote-access-portal
            portal_dest = '/home/Automata/remote-access-portal'
            user = 'Automata'  # ALWAYS Automata

            env_content = f"""# AutomataControls™ Configuration
# Generated by installer on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# © 2024 AutomataNexus, LLC. All rights reserved.

# Controller Information
CONTROLLER_SERIAL={self.controller_serial}
CONTROLLER_NAME=Nexus Controller ANC
LOCATION={location}

# API Keys
CLOUDFLARE_API={API_KEYS['CLOUDFLARE_API']}
RESEND_API={API_KEYS['RESEND_API']}
OPENWEATHER_API={API_KEYS['OPENWEATHER_API']}

# Authentication
API_AUTH_KEY={API_KEYS['API_AUTH_KEY']}
JWT_SECRET={API_KEYS['JWT_SECRET']}
SESSION_SECRET={API_KEYS['SESSION_SECRET']}

# Server Configuration
PORT={port}
HOST=0.0.0.0
NODE_ENV=production

# Hardware Configuration
I2C_BUS=1
ENABLE_HARDWARE=true
BOARD_SCAN_INTERVAL=5000

# Cloudflare Tunnel
TUNNEL_NAME={tunnel_name}
TUNNEL_DOMAIN={self.tunnel_domain}

# BMS Configuration
BMS_ENABLED={'true' if equipment else 'false'}
BMS_SERVER_URL=http://143.198.162.31:8205/api/v3/query_sql
BMS_LOCATION_ID=9
BMS_EQUIPMENT_ID={equipment if equipment else '5'}

# Weather Configuration
WEATHER_ENABLED=true
WEATHER_LOCATION={weather},US
WEATHER_UNITS=imperial
WEATHER_UPDATE_INTERVAL=600000

# Monitoring
ENABLE_MONITORING=true
LOG_LEVEL=info
LOG_TO_FILE=true
LOG_PATH=/var/log/automata-portal

# Security
ENABLE_HTTPS=false
CORS_ORIGIN=*
RATE_LIMIT=100

# Default Admin Credentials (Change on first login!)
DEFAULT_ADMIN_USERNAME=DevOps
DEFAULT_ADMIN_PASSWORD=Invertedskynet2$

# Email Configuration (Resend)
EMAIL_FROM=DevOps@automatacontrols.com
EMAIL_ADMIN=DevOps@automatacontrols.com
DEFAULT_RECIPIENT=DevOps@automatacontrols.com
"""
            
            # Make sure we write to the correct location
            env_path = '/home/Automata/remote-access-portal/.env'
            self.queue.put(('console', f'Writing .env file to {env_path}...\n'))

            try:
                # Write to temp file first
                temp_env_path = '/tmp/.env.tmp'
                with open(temp_env_path, 'w') as f:
                    f.write(env_content)

                # Move to final location with sudo
                subprocess.run(['sudo', 'cp', temp_env_path, env_path], check=True)
                subprocess.run(['sudo', 'chown', 'Automata:Automata', env_path], check=True)
                subprocess.run(['sudo', 'chmod', '644', env_path], check=True)  # Make readable

                # Verify file was created
                if os.path.exists(env_path):
                    file_size = os.path.getsize(env_path)
                    self.queue.put(('console', f'✓ Configuration saved to {env_path} ({file_size} bytes)\n'))
                else:
                    self.queue.put(('console', f'❌ ERROR: .env file not created at {env_path}\n'))
                    raise Exception('.env file creation failed')

                # Clean up temp file
                subprocess.run(['rm', '-f', temp_env_path], check=False)

            except Exception as e:
                self.queue.put(('console', f'❌ ERROR creating .env file: {str(e)}\n'))
                self.queue.put(('console', 'Installation cannot continue without .env file!\n'))
                raise

            self.queue.put(('console', '✓ .env file created successfully\n\n'))

            # STEP 7: Initialize SQLite Databases
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 7: INITIALIZING SQLITE DATABASES\n'))
            self.queue.put(('console', '═══════════════════════════════════\n\n'))
            self.queue.put(('progress', (32, 'Preparing to create 5 databases...')))

            # Create data directory if it doesn't exist
            data_dir = f'{portal_dest}/data'
            subprocess.run(['sudo', 'mkdir', '-p', data_dir], check=True)

            # Remove existing database files to ensure clean schema
            self.queue.put(('console', 'Removing old database files for clean install...\n'))
            for db_file in ['metrics.db', 'users.db', 'audit.db', 'alarms.db', 'weather.db']:
                db_path = f'{data_dir}/{db_file}'
                if os.path.exists(db_path):
                    subprocess.run(['sudo', 'rm', '-f', db_path], check=False)
                    self.queue.put(('console', f'  Removed old {db_file}\n'))

            subprocess.run(['sudo', 'chown', f'{user}:{user}', data_dir], check=True)

            # Initialize all 5 databases
            import sqlite3

            # 1. Create metrics.db
            self.queue.put(('console', '[1/5] Creating metrics database...\n'))
            self.queue.put(('progress', (34, 'Database 1/5: Creating metrics.db...')))
            metrics_db = sqlite3.connect(f'{data_dir}/metrics.db')
            metrics_cursor = metrics_db.cursor()

            # Drop existing tables and views to avoid conflicts
            try:
                metrics_cursor.execute("DROP TABLE IF EXISTS system_metrics")
                metrics_cursor.execute("DROP TABLE IF EXISTS nodered_readings")
                metrics_cursor.execute("DROP VIEW IF EXISTS system_metrics")
                metrics_cursor.execute("DROP VIEW IF EXISTS nodered_readings")
            except:
                pass

            # Create tables
            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS system_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    cpu_temp REAL,
                    cpu_usage REAL,
                    mem_used INTEGER,
                    mem_percent INTEGER,
                    disk_usage INTEGER,
                    uptime INTEGER,
                    load_average TEXT
                )
            ''')

            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS nodered_readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    setpoint REAL,
                    space_temp REAL,
                    supply_temp REAL,
                    return_temp REAL,
                    triac_1 INTEGER DEFAULT 0,
                    triac_2 INTEGER DEFAULT 0,
                    triac_3 INTEGER DEFAULT 0,
                    valve_position REAL,
                    alarm_status TEXT,
                    extra_data TEXT
                )
            ''')

            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarm_thresholds (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    parameter TEXT NOT NULL,
                    minValue REAL,
                    maxValue REAL,
                    unit TEXT,
                    enabled BOOLEAN DEFAULT 1,
                    alarmType TEXT DEFAULT 'warning',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Add board_configs table (app expects this name, not board_configurations)
            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS board_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    board_id TEXT UNIQUE NOT NULL,
                    board_type TEXT,
                    firmware_version TEXT,
                    last_seen DATETIME,
                    config_data TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Add system_config table
            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS system_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    category TEXT,
                    description TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Add NexusControllerMetrics table
            metrics_cursor.execute('''
                CREATE TABLE IF NOT EXISTS NexusControllerMetrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    controller_id TEXT,
                    metric_type TEXT,
                    metric_value REAL,
                    unit TEXT,
                    status TEXT
                )
            ''')

            # Create indexes only if tables exist
            try:
                metrics_cursor.execute('CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp)')
                metrics_cursor.execute('CREATE INDEX IF NOT EXISTS idx_nodered_timestamp ON nodered_readings(timestamp)')
            except sqlite3.OperationalError as e:
                self.queue.put(('console', f'⚠️ Index creation warning: {str(e)}\n'))

            metrics_db.commit()
            metrics_db.close()
            self.queue.put(('console', '✓ Metrics database created\n'))
            self.queue.put(('progress', (36, 'Database 1/5 complete')))

            # 2. Create users.db
            self.queue.put(('console', '[2/5] Creating users database...\n'))
            self.queue.put(('progress', (38, 'Database 2/5: Creating users.db...')))
            users_db = sqlite3.connect(f'{data_dir}/users.db')
            users_cursor = users_db.cursor()

            # Drop existing tables and views to avoid conflicts
            try:
                users_cursor.execute("DROP TABLE IF EXISTS users")
                users_cursor.execute("DROP TABLE IF EXISTS sessions")
                users_cursor.execute("DROP VIEW IF EXISTS users")
                users_cursor.execute("DROP VIEW IF EXISTS sessions")
            except:
                pass

            users_cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT DEFAULT 'viewer',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME,
                    is_active BOOLEAN DEFAULT 1,
                    two_factor_enabled BOOLEAN DEFAULT 0,
                    two_factor_secret TEXT
                )
            ''')

            users_cursor.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            ''')

            try:
                users_cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)')
                users_cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)')
                users_cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)')
            except sqlite3.OperationalError as e:
                self.queue.put(('console', f'⚠️ Index creation warning: {str(e)}\n'))

            # Insert default DevOps user with hashed password
            # Password: Invertedskynet2$
            users_cursor.execute('''
                INSERT OR IGNORE INTO users (username, email, password_hash, role)
                VALUES (?, ?, ?, ?)
            ''', ('DevOps', 'devops@automatacontrols.com', '$2a$10$pbyoaRLjrnkxEWZ6K6WpVOwR/PYdUGL3wv38MjyAjB10HmVUGr6mG', 'admin'))

            users_db.commit()
            users_db.close()
            self.queue.put(('console', '✓ Users database created with default admin user\n'))
            self.queue.put(('progress', (40, 'Database 2/5 complete')))

            # 3. Create audit.db
            self.queue.put(('console', '[3/5] Creating audit database...\n'))
            self.queue.put(('progress', (42, 'Database 3/5: Creating audit.db...')))
            audit_db = sqlite3.connect(f'{data_dir}/audit.db')
            audit_cursor = audit_db.cursor()

            # Drop existing tables and views to avoid conflicts
            try:
                audit_cursor.execute("DROP TABLE IF EXISTS audit_logs")
                audit_cursor.execute("DROP TABLE IF EXISTS system_events")
                audit_cursor.execute("DROP VIEW IF EXISTS audit_logs")
                audit_cursor.execute("DROP VIEW IF EXISTS system_events")
            except:
                pass

            audit_cursor.execute('''
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user_id INTEGER,
                    username TEXT,
                    action_type TEXT NOT NULL,
                    action_category TEXT,
                    description TEXT,
                    details TEXT,
                    ip_address TEXT,
                    user_agent TEXT,
                    session_id TEXT,
                    page_url TEXT,
                    component TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    success BOOLEAN DEFAULT 1,
                    error_message TEXT
                )
            ''')

            audit_cursor.execute('''
                CREATE TABLE IF NOT EXISTS system_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    event_type TEXT NOT NULL,
                    severity TEXT DEFAULT 'info',
                    source TEXT,
                    message TEXT,
                    details TEXT
                )
            ''')

            try:
                audit_cursor.execute('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)')
                audit_cursor.execute('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type)')
                audit_cursor.execute('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON system_events(timestamp)')
                audit_cursor.execute('CREATE INDEX IF NOT EXISTS idx_events_type ON system_events(event_type)')
            except sqlite3.OperationalError as e:
                self.queue.put(('console', f'⚠️ Index creation warning: {str(e)}\n'))
            audit_db.commit()
            audit_db.close()
            self.queue.put(('console', '✓ Audit database created\n'))
            self.queue.put(('progress', (44, 'Database 3/5 complete')))

            # 4. Create alarms.db
            self.queue.put(('console', '[4/5] Creating alarms database...\n'))
            self.queue.put(('progress', (46, 'Database 4/5: Creating alarms.db...')))
            alarms_db = sqlite3.connect(f'{data_dir}/alarms.db')
            alarms_cursor = alarms_db.cursor()

            # Drop existing tables and views to avoid conflicts
            try:
                alarms_cursor.execute("DROP TABLE IF EXISTS alarm_configs")
                alarms_cursor.execute("DROP TABLE IF EXISTS alarm_history")
                alarms_cursor.execute("DROP TABLE IF EXISTS alarm_recipients")
                alarms_cursor.execute("DROP VIEW IF EXISTS alarm_configs")
                alarms_cursor.execute("DROP VIEW IF EXISTS alarm_history")
                alarms_cursor.execute("DROP VIEW IF EXISTS alarm_recipients")
            except:
                pass

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS active_alarms (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alarm_id TEXT UNIQUE NOT NULL,
                    alarm_name TEXT NOT NULL,
                    alarm_type TEXT,
                    severity TEXT,
                    parameter TEXT,
                    current_value REAL,
                    threshold_value REAL,
                    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    acknowledged BOOLEAN DEFAULT 0,
                    acknowledged_by TEXT,
                    acknowledged_at DATETIME,
                    notes TEXT
                )
            ''')

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarm_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    config_name TEXT UNIQUE NOT NULL,
                    parameter TEXT NOT NULL,
                    alarm_type TEXT,
                    min_threshold REAL,
                    max_threshold REAL,
                    severity TEXT,
                    enabled BOOLEAN DEFAULT 1,
                    delay_seconds INTEGER DEFAULT 0,
                    email_notification BOOLEAN DEFAULT 0,
                    sms_notification BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME
                )
            ''')

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarm_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alarm_id TEXT NOT NULL,
                    alarm_name TEXT NOT NULL,
                    alarm_type TEXT,
                    severity TEXT,
                    parameter TEXT,
                    value REAL,
                    threshold_value REAL,
                    triggered_at DATETIME,
                    cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    duration_seconds INTEGER,
                    acknowledged BOOLEAN,
                    acknowledged_by TEXT,
                    notes TEXT
                )
            ''')

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarm_recipients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL,
                    name TEXT NOT NULL,
                    active BOOLEAN DEFAULT 1
                )
            ''')

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarms (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    type TEXT NOT NULL,
                    description TEXT,
                    value REAL,
                    threshold REAL,
                    severity TEXT,
                    acknowledged BOOLEAN DEFAULT 0,
                    acknowledged_by TEXT,
                    acknowledged_at DATETIME
                )
            ''')

            alarms_cursor.execute('''
                CREATE TABLE IF NOT EXISTS alarm_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    monitoring_enabled BOOLEAN DEFAULT 1,
                    email_notifications BOOLEAN DEFAULT 0,
                    high_temp_threshold REAL DEFAULT 85,
                    low_temp_threshold REAL DEFAULT 65,
                    high_amp_threshold REAL DEFAULT 30,
                    low_amp_threshold REAL DEFAULT 5
                )
            ''')

            try:
                alarms_cursor.execute('CREATE INDEX IF NOT EXISTS idx_active_alarms_id ON active_alarms(alarm_id)')
                alarms_cursor.execute('CREATE INDEX IF NOT EXISTS idx_alarm_history_timestamp ON alarm_history(triggered_at)')
                alarms_cursor.execute('CREATE INDEX IF NOT EXISTS idx_alarm_configs_param ON alarm_configs(parameter)')
            except sqlite3.OperationalError as e:
                self.queue.put(('console', f'⚠️ Index creation warning: {str(e)}\n'))
            alarms_db.commit()
            alarms_db.close()
            self.queue.put(('console', '✓ Alarms database created\n'))
            self.queue.put(('progress', (48, 'Database 4/5 complete')))

            # 5. Create weather.db
            self.queue.put(('console', '[5/5] Creating weather database...\n'))
            self.queue.put(('progress', (50, 'Database 5/5: Creating weather.db...')))
            weather_db = sqlite3.connect(f'{data_dir}/weather.db')
            weather_cursor = weather_db.cursor()

            # Drop existing tables and views to avoid conflicts
            try:
                weather_cursor.execute("DROP TABLE IF EXISTS weather_data")
                weather_cursor.execute("DROP TABLE IF EXISTS weather_forecasts")
                weather_cursor.execute("DROP VIEW IF EXISTS weather_data")
                weather_cursor.execute("DROP VIEW IF EXISTS weather_forecasts")
            except:
                pass

            weather_cursor.execute('''
                CREATE TABLE IF NOT EXISTS weather_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    temperature REAL,
                    humidity REAL,
                    pressure REAL,
                    wind_speed REAL,
                    wind_direction INTEGER,
                    conditions TEXT,
                    icon TEXT,
                    sunrise INTEGER,
                    sunset INTEGER,
                    location TEXT
                )
            ''')

            weather_cursor.execute('''
                CREATE TABLE IF NOT EXISTS weather_forecasts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    forecast_time DATETIME,
                    temperature REAL,
                    humidity REAL,
                    conditions TEXT,
                    precipitation_chance REAL,
                    wind_speed REAL,
                    location TEXT
                )
            ''')

            try:
                weather_cursor.execute('CREATE INDEX IF NOT EXISTS idx_weather_timestamp ON weather_data(timestamp)')
                weather_cursor.execute('CREATE INDEX IF NOT EXISTS idx_forecast_timestamp ON weather_forecasts(forecast_time)')
            except sqlite3.OperationalError as e:
                self.queue.put(('console', f'⚠️ Index creation warning: {str(e)}\n'))
            weather_db.commit()
            weather_db.close()
            self.queue.put(('console', '✓ Weather database created\n'))
            self.queue.put(('progress', (52, 'Database 5/5 complete')))

            # Set permissions on all database files
            self.queue.put(('console', 'Setting database permissions...\n'))
            subprocess.run(['sudo', 'chown', '-R', f'{user}:{user}', data_dir], check=True)
            subprocess.run(['sudo', 'chmod', '644', f'{data_dir}/*.db'], shell=True, check=False)

            self.queue.put(('console', '✓ All 5 databases initialized successfully\n'))
            self.queue.put(('progress', (55, 'Databases ready')))
            self.queue.put(('console', '  Default admin user: DevOps / Invertedskynet2$\n\n'))

            # STEP 8: Create Node-RED flow configuration
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 8: CREATING NODE-RED FLOW CONFIGURATION\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (35, 'Setting up Node-RED flows...')))
            
            nodered_flow = '''[
    {
        "id": "readings_api",
        "type": "http in",
        "z": "flow_id",
        "name": "Readings API",
        "url": "/api/readings",
        "method": "get",
        "x": 110,
        "y": 100,
        "wires": [["prepare_readings"]]
    },
    {
        "id": "prepare_readings",
        "type": "function",
        "z": "flow_id",
        "name": "Prepare Readings Data",
        "func": "const readings = {\\n    inputs: {\\n        setpoint: global.get('setpoint') || 72.0,\\n        space: global.get('space_temp') || 74.5,\\n        supply: global.get('supply_temp') || 55.0,\\n        amps: global.get('current') || 8.5\\n    },\\n    outputs: {\\n        triacs: {\\n            triac1: global.get('triac1_enabled') || false,\\n            triac2: global.get('triac2_enabled') || false,\\n            triac3: global.get('triac3_enabled') || false,\\n            triac4: global.get('triac4_enabled') || false\\n        },\\n        analog: {\\n            ao1: global.get('ao1_percent') || 0,\\n            ao2: global.get('ao2_percent') || 0,\\n            ao3: global.get('ao3_percent') || 0,\\n            ao4: global.get('ao4_percent') || 0\\n        }\\n    },\\n    alarms: global.get('active_alarms') || []\\n};\\n\\nmsg.payload = readings;\\nreturn msg;",
        "outputs": 1,
        "x": 340,
        "y": 100,
        "wires": [["http_response"]]
    },
    {
        "id": "http_response",
        "type": "http response",
        "z": "flow_id",
        "name": "Send Response",
        "x": 560,
        "y": 100,
        "wires": []
    },
    {
        "id": "thresholds_api",
        "type": "http in",
        "z": "flow_id",
        "name": "Thresholds GET",
        "url": "/api/thresholds",
        "method": "get",
        "x": 120,
        "y": 200,
        "wires": [["get_thresholds"]]
    },
    {
        "id": "get_thresholds",
        "type": "function",
        "z": "flow_id",
        "name": "Get Thresholds",
        "func": "const thresholds = global.get('alarm_thresholds') || [];\\nmsg.payload = thresholds;\\nreturn msg;",
        "outputs": 1,
        "x": 340,
        "y": 200,
        "wires": [["http_response2"]]
    },
    {
        "id": "http_response2",
        "type": "http response",
        "z": "flow_id",
        "name": "Send Response",
        "x": 560,
        "y": 200,
        "wires": []
    }
]'''
            
            nodered_flow_path = f'{portal_dest}/nodered-readings-flow.json'
            with open(nodered_flow_path, 'w') as f:
                f.write(nodered_flow)
            
            subprocess.run(['sudo', 'chown', f'{user}:{user}', nodered_flow_path], check=True)
            self.queue.put(('console', f'✓ Node-RED flow saved to {nodered_flow_path}\n'))
            self.queue.put(('console', '  Import this flow into Node-RED to enable readings API\n\n'))
            
            # STEP 9: Install Cloudflare tunnel (32-bit ARM)
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 9: INSTALLING CLOUDFLARE TUNNEL\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (40, 'Installing Cloudflare tunnel...')))
            
            # Download and install cloudflared for 32-bit ARM (armhf)
            cloudflared_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-armhf"
            cloudflared_path = "/usr/local/bin/cloudflared"
            
            self.queue.put(('console', 'Downloading cloudflared for 32-bit ARM...\n'))
            subprocess.run(['wget', '-O', cloudflared_path, cloudflared_url], check=True, capture_output=True)
            subprocess.run(['chmod', '+x', cloudflared_path], check=True)
            
            self.queue.put(('console', '✓ Cloudflared installed\n\n'))
            
            # STEP 10: Create Cloudflare tunnel programmatically
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 10: CREATING CLOUDFLARE TUNNEL\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (50, 'Creating tunnel...')))
            
            import requests
            import uuid
            
            # Create .cloudflared directory
            cloudflared_dir = f'/home/{user}/.cloudflared'
            os.makedirs(cloudflared_dir, exist_ok=True)
            
            # Generate tunnel credentials
            tunnel_id = str(uuid.uuid4())
            tunnel_secret = base64.b64encode(os.urandom(32)).decode('utf-8')
            
            # Use Cloudflare API to create tunnel
            cf_api_token = API_KEYS['CLOUDFLARE_API']
            
            # Get account ID first
            headers = {
                'Authorization': f'Bearer {cf_api_token}',
                'Content-Type': 'application/json'
            }
            
            # Get account details
            account_response = requests.get(
                'https://api.cloudflare.com/client/v4/accounts',
                headers=headers
            )
            
            if account_response.status_code == 200:
                accounts = account_response.json()
                if accounts['result']:
                    account_id = accounts['result'][0]['id']
                    
                    # Create tunnel via API
                    tunnel_response = requests.post(
                        f'https://api.cloudflare.com/client/v4/accounts/{account_id}/tunnels',
                        headers=headers,
                        json={
                            'name': tunnel_name,
                            'tunnel_secret': tunnel_secret,
                            'config_src': 'local'
                        }
                    )
                    
                    if tunnel_response.status_code in [200, 201]:
                        tunnel_data = tunnel_response.json()
                        tunnel_id = tunnel_data['result']['id']
                        tunnel_token = tunnel_data['result']['token']
                        
                        self.queue.put(('console', f'✓ Tunnel created: {tunnel_name}\n'))
                        self.queue.put(('console', f'  Tunnel ID: {tunnel_id}\n'))
                    else:
                        self.queue.put(('console', f'⚠️ Using local tunnel config\n'))
            else:
                # Fallback to local config
                self.queue.put(('console', '⚠️ API authentication failed, using local config\n'))
            
            # Create tunnel credentials file
            cred_file = f'{cloudflared_dir}/{tunnel_id}.json'
            cred_data = {
                'AccountTag': account_id if 'account_id' in locals() else '',
                'TunnelSecret': tunnel_secret,
                'TunnelID': tunnel_id
            }
            
            with open(cred_file, 'w') as f:
                json.dump(cred_data, f)
            
            subprocess.run(['chmod', '600', cred_file], check=True)
            
            # Create config.yml - point directly to app port
            config_yml = f"""tunnel: {tunnel_id}
credentials-file: {cred_file}

ingress:
  - hostname: {self.tunnel_domain}
    service: http://localhost:{port}
  - service: http_status:404
"""
            
            config_path = f'{cloudflared_dir}/config.yml'
            with open(config_path, 'w') as f:
                f.write(config_yml)
            
            subprocess.run(['chown', '-R', f'{user}:{user}', cloudflared_dir], check=True)
            
            # Create DNS route
            if 'account_id' in locals():
                self.queue.put(('console', 'Creating DNS record...\n'))
                
                # Get zone ID for automatacontrols.com
                zones_response = requests.get(
                    'https://api.cloudflare.com/client/v4/zones',
                    headers=headers,
                    params={'name': 'automatacontrols.com'}
                )
                
                if zones_response.status_code == 200:
                    zones = zones_response.json()
                    if zones['result']:
                        zone_id = zones['result'][0]['id']
                        
                        # Create DNS record
                        dns_response = requests.post(
                            f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records',
                            headers=headers,
                            json={
                                'type': 'CNAME',
                                'name': tunnel_name,
                                'content': f'{tunnel_id}.cfargotunnel.com',
                                'proxied': True
                            }
                        )
                        
                        if dns_response.status_code in [200, 201]:
                            self.queue.put(('console', f'✓ DNS record created for {self.tunnel_domain}\n'))
                        else:
                            self.queue.put(('console', f'⚠️ Failed to create DNS record: {dns_response.text}\n'))
                    else:
                        self.queue.put(('console', '⚠️ Could not find zone automatacontrols.com\n'))
                else:
                    self.queue.put(('console', f'⚠️ Failed to get zones: {zones_response.text}\n'))
            
            self.queue.put(('console', f'✓ Tunnel configured: {self.tunnel_domain}\n\n'))
            
            # STEP 11: Configure NGINX (skip if not needed for direct tunnel)
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 11: CONFIGURING NGINX (OPTIONAL)\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (60, 'Checking NGINX...')))

            # Skip NGINX configuration since Cloudflare tunnel connects directly to app
            self.queue.put(('console', 'Cloudflare tunnel will connect directly to port ' + str(port) + '\n'))
            self.queue.put(('console', 'NGINX configuration not required for tunnel setup\n\n'))

            # Old NGINX code commented out - keeping for reference
            '''
            
            # Create FULL NGINX configuration with WebSocket support
            nginx_config = f"""server {{
    listen 80;
    server_name {self.tunnel_domain} localhost;
    
    # Gzip compression
    gzip on;
    gzip_types text/plain text/css text/javascript application/javascript application/json;
    gzip_min_length 1000;
    
    client_max_body_size 100M;
    
    # Main application with WebSocket support
    location / {{
        proxy_pass http://localhost:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }}
    
    # Socket.IO specific path
    location /socket.io/ {{
        proxy_pass http://localhost:{port}/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Important for Socket.IO
        proxy_buffering off;
        proxy_read_timeout 86400;
    }}
    
    # Node-RED proxy with WebSocket support
    location /node-red {{
        proxy_pass http://localhost:1880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Node-RED WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }}
    
    # Node-RED API endpoints
    location /node-red/api/ {{
        proxy_pass http://localhost:1880/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}
"""
            
            # Write NGINX config
            nginx_conf_path = f'/etc/nginx/sites-available/{tunnel_name}'
            with open(nginx_conf_path, 'w') as f:
                f.write(nginx_config)
            
            # Enable site
            subprocess.run(['sudo', 'ln', '-sf', nginx_conf_path, f'/etc/nginx/sites-enabled/{tunnel_name}'], capture_output=True)
            
            # Remove default site if it exists
            subprocess.run(['sudo', 'rm', '-f', '/etc/nginx/sites-enabled/default'], capture_output=True)
            
            # Test and reload NGINX
            nginx_test = subprocess.run(['sudo', 'nginx', '-t'], capture_output=True, text=True)
            if nginx_test.returncode == 0:
                subprocess.run(['sudo', 'systemctl', 'restart', 'nginx'], capture_output=True)
                self.queue.put(('console', '✓ NGINX configured and restarted\n\n'))
            else:
                self.queue.put(('console', f'⚠️ NGINX configuration test failed: {nginx_test.stderr}\n\n'))
            '''

            # STEP 12: Create log directory and rotation
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 12: CREATING LOG DIRECTORY AND ROTATION\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (65, 'Setting up logging...')))
            
            log_dir = '/var/log/automata-portal'
            subprocess.run(['sudo', 'mkdir', '-p', log_dir], check=True)
            subprocess.run(['sudo', 'chown', f'{user}:{user}', log_dir], check=True)
            self.queue.put(('console', f'✓ Log directory created: {log_dir}\n'))
            
            # Create PM2 logs directory
            pm2_log_dir = f'{portal_dest}/logs'
            subprocess.run(['sudo', 'mkdir', '-p', pm2_log_dir], check=True)
            subprocess.run(['sudo', 'chown', f'{user}:{user}', pm2_log_dir], check=True)
            
            # Create logrotate configuration
            logrotate_config = f"""{log_dir}/*.log {{
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 640 {user} {user}
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}}

{portal_dest}/logs/*.log {{
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 640 {user} {user}
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}}
"""
            
            logrotate_path = '/etc/logrotate.d/automata-portal'
            with open(logrotate_path, 'w') as f:
                f.write(logrotate_config)
            
            self.queue.put(('console', '✓ Log rotation configured\n\n'))
            
            # STEP 13: Install PM2 and create restart script
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 13: INSTALLING PM2 PROCESS MANAGER\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (70, 'Installing PM2...')))
            
            # Install PM2 globally
            self.queue.put(('console', 'Installing PM2 globally...\n'))
            if npm_path:
                pm2_install = subprocess.run(['sudo', npm_path, 'install', '-g', 'pm2'],
                                           capture_output=True, text=True)
            else:
                pm2_install = subprocess.run(['sudo', 'npm', 'install', '-g', 'pm2'],
                                           capture_output=True, text=True)
            if pm2_install.returncode == 0:
                self.queue.put(('console', '✓ PM2 installed\n'))
            else:
                self.queue.put(('console', '⚠️ PM2 may already be installed\n'))
            
            # Create PM2 ecosystem config
            ecosystem_config = f"""module.exports = {{
  apps: [
    {{
      name: 'nexus-portal',
      script: './server.js',
      cwd: '{portal_dest}',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {{
        NODE_ENV: 'production',
        PORT: {port},
        HOST: '0.0.0.0'
      }},
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true
    }}
  ]
}};"""
            
            ecosystem_path = f'{portal_dest}/ecosystem.config.js'
            with open(ecosystem_path, 'w') as f:
                f.write(ecosystem_config)
            
            subprocess.run(['sudo', 'chown', f'{user}:{user}', ecosystem_path], check=True)
            self.queue.put(('console', '✓ PM2 ecosystem config created\n'))
            
            # Create restart script
            restart_script = f'''#!/bin/bash

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           AutomataNexus Portal Restart Script                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

print_status() {{
    echo -e "${{GREEN}}[✓]${{NC}} $1"
}}

print_error() {{
    echo -e "${{RED}}[✗]${{NC}} $1"
}}

print_info() {{
    echo -e "${{YELLOW}}[*]${{NC}} $1"
}}

# Kill all Node processes
print_info "Stopping all Node processes..."
pm2 kill 2>/dev/null || killall node 2>/dev/null
sleep 2

# Clean build cache
print_info "Cleaning build cache..."
cd {portal_dest}
rm -rf .next .next-cache build dist 2>/dev/null
print_status "Cache cleaned"

# Rebuild the application
print_info "Rebuilding application..."
npm run build
if [ $? -eq 0 ]; then
    print_status "Build completed successfully"
else
    print_error "Build failed!"
    exit 1
fi

# Create logs directory
mkdir -p logs

# Start with PM2
print_info "Starting services with PM2..."
pm2 delete nexus-portal 2>/dev/null
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u {user} --hp /home/{user} 2>/dev/null

print_status "Portal restarted successfully!"
echo ""
pm2 status

# Optional: Open in fullscreen browser
if [ "$1" == "--browser" ]; then
    print_info "Opening portal in fullscreen browser..."
    sleep 3
    chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate "http://localhost:{port}" &
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  Portal: http://localhost:{port}                               ║"
echo "║  Logs: pm2 logs nexus-portal                                 ║"
echo "║  Stop: pm2 stop nexus-portal                                 ║"
echo "║  Restart: ./restartnexus.sh                                  ║"
echo "║  Fullscreen: ./restartnexus.sh --browser                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
'''
            
            restart_script_path = f'{portal_dest}/restartnexus.sh'
            with open(restart_script_path, 'w') as f:
                f.write(restart_script)
            
            subprocess.run(['chmod', '+x', restart_script_path], check=True)
            subprocess.run(['sudo', 'chown', f'{user}:{user}', restart_script_path], check=True)
            self.queue.put(('console', '✓ Restart script created\n'))

            # Create symlink for global access
            subprocess.run(['sudo', 'ln', '-sf', restart_script_path, '/usr/local/bin/restartnexus'], capture_output=True)
            self.queue.put(('console', '✓ Created global command: restartnexus\n'))

            # Create claudecode.sh script for reinstalling Claude Code
            claudecode_script = f'''#!/bin/bash
# Claude Code Clean Reinstall Script
echo "===================================="
echo "Claude Code Clean Reinstall"
echo "===================================="

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

if [[ $EUID -ne 0 ]]; then
   echo -e "${{RED}}[!]${{NC}} This script must be run with sudo"
   exit 1
fi

echo -e "${{YELLOW}}[*]${{NC}} Starting Claude Code clean reinstall..."
npm uninstall -g @anthropic-ai/claude-code 2>/dev/null
rm -rf /usr/lib/node_modules/@anthropic-ai/claude-code 2>/dev/null
rm -rf /usr/lib/node_modules/@anthropic-ai/.claude-code* 2>/dev/null
echo -e "${{GREEN}}[✓]${{NC}} Cleaned up Claude Code directories"

echo -e "${{YELLOW}}[*]${{NC}} Installing Claude Code for ARM64 Linux..."
npm install -g @anthropic-ai/claude-code --target_arch=arm64 --target_platform=linux

if [ $? -eq 0 ]; then
    echo -e "${{GREEN}}[✓]${{NC}} Claude Code successfully installed!"
    echo "You can now use Claude Code by running: claude"
else
    echo -e "${{RED}}[✗]${{NC}} Failed to install Claude Code"
    exit 1
fi
'''
            claudecode_path = f'{portal_dest}/claudecode.sh'
            with open(claudecode_path, 'w') as f:
                f.write(claudecode_script)
            subprocess.run(['chmod', '+x', claudecode_path], check=True)
            subprocess.run(['sudo', 'chown', f'{user}:{user}', claudecode_path], check=True)
            self.queue.put(('console', '✓ Claude Code reinstall script created\n\n'))

            # Create systemd services for compatibility
            self.queue.put(('console', 'Creating system services...\n'))
            
            # Create cloudflared service
            cloudflared_service = f"""[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=notify
User={user}
Group={user}
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
"""
            
            service_path = '/etc/systemd/system/cloudflared.service'
            with open('/tmp/cloudflared.service', 'w') as f:
                f.write(cloudflared_service)
            subprocess.run(['sudo', 'mv', '/tmp/cloudflared.service', service_path], check=True)
            subprocess.run(['sudo', 'chmod', '644', service_path], check=True)
            
            self.queue.put(('console', '✓ Cloudflared service created\n\n'))
            
            # STEP 14: Start services with PM2 and systemd
            self.queue.put(('console', '═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 14: STARTING SERVICES\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (85, 'Starting services...')))
            
            # Start portal with PM2
            self.queue.put(('console', 'Starting portal with PM2...\n'))
            os.chdir(portal_dest)
            subprocess.run(['sudo', '-u', user, 'pm2', 'delete', 'nexus-portal'], capture_output=True)
            pm2_start = subprocess.run(['sudo', '-u', user, 'pm2', 'start', 'ecosystem.config.js'], 
                                     capture_output=True, text=True)
            
            if pm2_start.returncode == 0:
                self.queue.put(('console', '✓ Portal started with PM2\n'))
            else:
                self.queue.put(('console', f'⚠️ PM2 start warning: {pm2_start.stderr}\n'))
            
            # Save PM2 configuration
            subprocess.run(['sudo', '-u', user, 'pm2', 'save'], capture_output=True)

            # Setup PM2 to start on boot - this generates a command that must be run as root
            self.queue.put(('console', 'Configuring PM2 to start on boot...\n'))
            pm2_startup_cmd = subprocess.run(['sudo', '-u', user, 'pm2', 'startup', 'systemd',
                                            '-u', user, '--hp', f'/home/{user}'],
                                           capture_output=True, text=True)

            # The output contains the command to run, extract and execute it
            if pm2_startup_cmd.stdout:
                # PM2 outputs a command like: sudo env PATH=... pm2 startup systemd...
                # We need to execute this command
                lines = pm2_startup_cmd.stdout.split('\n')
                for line in lines:
                    if 'sudo env PATH=' in line:
                        # Execute the generated command
                        subprocess.run(line, shell=True, capture_output=True)
                        break

            # Alternative method: directly create the systemd service
            subprocess.run(['sudo', 'env', f'PATH={os.environ.get("PATH", "/usr/bin:/bin")}',
                          f'PM2_HOME=/home/{user}/.pm2', 'pm2', 'startup', 'systemd',
                          '-u', user, '--hp', f'/home/{user}'], capture_output=True)

            self.queue.put(('console', '✓ PM2 configured to start on boot\n'))
            
            # Start cloudflared with systemd
            self.queue.put(('console', 'Starting Cloudflare tunnel service...\n'))
            subprocess.run(['sudo', 'systemctl', 'daemon-reload'], check=True)

            # Enable the service to start on boot
            enable_result = subprocess.run(['sudo', 'systemctl', 'enable', 'cloudflared'],
                                         capture_output=True, text=True)
            if enable_result.returncode == 0:
                self.queue.put(('console', '✓ Cloudflare tunnel enabled for boot\n'))
            else:
                self.queue.put(('console', f'⚠️ Could not enable tunnel: {enable_result.stderr}\n'))

            # Start the service now
            start_result = subprocess.run(['sudo', 'systemctl', 'start', 'cloudflared'],
                                        capture_output=True, text=True)
            if start_result.returncode == 0:
                self.queue.put(('console', '✓ Cloudflare tunnel started\n'))
            else:
                self.queue.put(('console', f'⚠️ Could not start tunnel: {start_result.stderr}\n'))
            
            # Wait for services to start
            time.sleep(5)
            
            # Check service status
            pm2_status = subprocess.run(['sudo', '-u', user, 'pm2', 'status'], 
                                      capture_output=True, text=True)
            tunnel_status = subprocess.run(['sudo', 'systemctl', 'is-active', 'cloudflared'],
                                         capture_output=True, text=True)
            
            if 'online' in pm2_status.stdout.lower():
                self.queue.put(('console', '✓ Portal running in PM2\n'))
            else:
                self.queue.put(('console', '⚠️ Portal may not be running - check pm2 logs\n'))
            
            if tunnel_status.stdout.strip() == 'active':
                self.queue.put(('console', '✓ Tunnel service running\n'))
            else:
                self.queue.put(('console', '⚠️ Tunnel service not running - check logs\n'))
            
            # STEP 15: Setup fullscreen auto-launch
            self.queue.put(('console', '\n═══════════════════════════════════════\n'))
            self.queue.put(('console', 'STEP 15: CONFIGURING FULLSCREEN AUTO-LAUNCH\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('progress', (90, 'Configuring auto-launch...')))
            
            # Create autostart script for fullscreen browser
            autostart_script = f'''#!/bin/bash
# AutomataNexus Portal Fullscreen Launcher
sleep 10  # Wait for X server and network
export DISPLAY=:0
chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate "http://localhost:{port}" &
'''
            
            # Create autostart directory if it doesn't exist
            autostart_dir = f'/home/{user}/.config/autostart'
            subprocess.run(['sudo', 'mkdir', '-p', autostart_dir], check=True)
            subprocess.run(['sudo', 'chown', '-R', f'{user}:{user}', f'/home/{user}/.config'], check=True)
            
            # Create desktop entry for autostart
            desktop_entry = f'''[Desktop Entry]
Type=Application
Name=AutomataNexus Portal
Exec=/home/{user}/remote-access-portal/launch-fullscreen.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=Launch AutomataNexus Portal in fullscreen
'''
            
            desktop_path = f'{autostart_dir}/automata-portal.desktop'
            with open(desktop_path, 'w') as f:
                f.write(desktop_entry)
            
            subprocess.run(['sudo', 'chown', f'{user}:{user}', desktop_path], check=True)
            
            # Create the launch script
            launch_script_path = f'{portal_dest}/launch-fullscreen.sh'
            with open(launch_script_path, 'w') as f:
                f.write(autostart_script)
            
            subprocess.run(['chmod', '+x', launch_script_path], check=True)
            subprocess.run(['sudo', 'chown', f'{user}:{user}', launch_script_path], check=True)
            
            self.queue.put(('console', '✓ Fullscreen auto-launch configured\n'))
            
            # STEP 16: Optional Claude Code installation
            if self.install_claude_code.get():
                self.queue.put(('console', '\n═══════════════════════════════════════\n'))
                self.queue.put(('console', 'STEP 16: INSTALLING CLAUDE CODE CLI (OPTIONAL)\n'))
                self.queue.put(('console', '═══════════════════════════════════════\n\n'))
                self.queue.put(('progress', (95, 'Installing Claude Code...')))
                
                self.queue.put(('console', 'Installing Claude Code CLI...\n'))
                if npm_path:
                    claude_install = subprocess.run(['sudo', npm_path, 'install', '-g', '@anthropic-ai/claude-code'],
                                                  capture_output=True, text=True)
                else:
                    claude_install = subprocess.run(['sudo', 'npm', 'install', '-g', '@anthropic-ai/claude-code'],
                                                  capture_output=True, text=True)
                
                if claude_install.returncode == 0:
                    self.queue.put(('console', '✓ Claude Code CLI installed successfully\n'))
                    self.queue.put(('console', '\n⚠️ IMPORTANT: To complete Claude Code setup:\n'))
                    self.queue.put(('console', '1. Open a terminal and run: claude-code\n'))
                    self.queue.put(('console', '2. A browser will open with a QR code\n'))
                    self.queue.put(('console', '3. Take a photo of the QR code to save it\n'))
                    self.queue.put(('console', '4. Use the QR code to authenticate Claude Code\n\n'))
                else:
                    self.queue.put(('console', f'⚠️ Claude Code installation failed: {claude_install.stderr}\n'))
            
            self.queue.put(('console', '\n'))
            self.queue.put(('progress', (100, 'Installation complete!')))
            self.queue.put(('console', '\n═══════════════════════════════════════\n'))
            self.queue.put(('console', '✓ INSTALLATION COMPLETE!\n'))
            self.queue.put(('console', '═══════════════════════════════════════\n\n'))
            self.queue.put(('console', f'Controller Serial: {self.controller_serial}\n'))
            self.queue.put(('console', f'Portal URL: http://localhost:{port}\n'))
            self.queue.put(('console', f'Tunnel URL: https://{self.tunnel_domain}\n'))
            
            if self.install_claude_code.get():
                self.queue.put(('console', '\nRun "claude-code" in terminal to complete Claude Code setup\n'))
            
        except Exception as e:
            self.queue.put(('console', f'\n❌ ERROR: {str(e)}\n'))
            self.queue.put(('progress', (0, 'Installation failed')))
        finally:
            self.is_installing = False
            self.queue.put(('done', None))
    
    def cancel_installation(self):
        """Cancel the installation"""
        if self.is_installing:
            self.is_installing = False
            self.queue.put(('console', '\n\n⚠️ Installation cancelled by user\n'))
    
    def check_queue(self):
        """Check for updates from installation thread"""
        try:
            while True:
                msg_type, msg_data = self.queue.get_nowait()
                
                if msg_type == 'console':
                    self.console.insert(tk.END, msg_data)
                    self.console.see(tk.END)
                elif msg_type == 'progress':
                    percent, message = msg_data
                    self.update_progress(percent, message)
                elif msg_type == 'done':
                    self.install_btn.config(state='normal')
                    self.cancel_btn.config(state='disabled')
        except queue.Empty:
            pass
        
        # Schedule next check
        self.root.after(100, self.check_queue)

def main():
    root = tk.Tk()
    app = TunnelInstallerGUI(root)
    root.mainloop()

if __name__ == "__main__":
    # Check if running as root
    if os.geteuid() != 0:
        print("This installer must be run with sudo privileges")
        sys.exit(1)
    
    main()