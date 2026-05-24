const App = {
    state: {
        courses: [],
        user: null,
        orders: [],
        activeView: "dashboard", // 'dashboard' or 'learning'
        currentItemRef: { courseId: null, lessonId: null },
        searchQuery: "",
        currentPage: 1,
        itemsPerPage: 8,
        theme: "dark",
        currentRating: 0,
        cart: [],
    },
    dom: {},

    // ========================================================
    // KHỞI TẠO & QUẢN LÝ DỮ LIỆU
    // ========================================================
    async init() {
        try {
            this.mapDomElements();
            this.applyInitialTheme();
            this.addEventListeners();

            // Hiển thị giao diện khung xương (skeleton) ngay lập tức
            this.renderSkeletonCards(8);

            // Bắt đầu tải dữ liệu thật
            await this.checkAuth();
            await this.loadData();

            // Render dữ liệu thật (sẽ thay thế skeleton)
            this.renderDashboardCourses();
            this.updateUserInfoDisplay();
            this.renderCategoryDropdown();

            // Bắt đầu Polling kiểm tra trạng thái đơn hàng (Mỗi 10 giây)
            setInterval(() => this.pollOrderUpdates(), 10000);
        } catch (error) {
            console.error("Lỗi khởi tạo hệ thống:", error);
        } finally {
            // Luôn ẩn màn hình loading dù có lỗi xảy ra để không làm treo trang
            this.hidePageLoader();
        }
    },

    mapDomElements() {
        this.dom = {
            // Views
            dashboardView: document.getElementById("dashboard-view"),
            learningView: document.getElementById("learning-view"),
            // Header
            userFullnameDisplay: document.getElementById("user-fullname-display"),
            userEmailDisplay: document.getElementById("user-email-display"),
            btnBackToDashboard: document.getElementById("btn-back-to-dashboard"),
            // Dashboard
            coursesGrid: document.getElementById("dashboard-courses-grid"),
            courseCountText: document.getElementById("course-count"),
            mainSectionTitle: document.getElementById("main-section-title"),
            heroSection: document.getElementById("hero-section"),
            headerSearchInput: document.getElementById("header-search-input"),
            categoryList: document.getElementById("header-category-list"),
            paginationContainer: document.getElementById("dashboard-pagination"),
            // Learning View - Sidebar
            sidebar: document.getElementById("app-sidebar"),
            sidebarBackdrop: document.getElementById("sidebar-backdrop"),
            courseSelector: document.getElementById("course-selector"),
            sidebarCourseTitle: document.getElementById("sidebar-course-title"),
            overallProgressText: document.getElementById("overall-progress-text"),
            overallProgress: document.getElementById("overall-progress"),
            courseNavigation: document.getElementById("course-navigation"),
            // Learning View - Main Content
            videoWrapper: document.getElementById("video-wrapper"),
            lessonMainTitle: document.getElementById("lesson-main-title"),
            lessonMainDesc: document.getElementById("lesson-main-desc"),
            // Tabs
            tabButtons: document.querySelectorAll('[id^="tab-btn-"]'),
            tabContents: document.querySelectorAll('[id^="tab-content-"]'),
            // Quiz
            quizContainer: document.getElementById("quiz-container"),
            quizQuestionText: document.getElementById("quiz-question-text"),
            quizOptionsWrapper: document.getElementById("quiz-options-wrapper"),
            quizResult: document.getElementById("quiz-result"),
            // AI Chat
            aiChatLog: document.getElementById("ai-chat-log"),
            aiChatInput: document.getElementById("ai-chat-input"),
            // Terminal
            terminalBody: document.getElementById("terminal-body"),
            terminalHistory: document.getElementById("terminal-history"),
            terminalInput: document.getElementById("terminal-cmd-input"),
            // Modals
            paymentModal: document.getElementById("payment-modal"),
            accountModal: document.getElementById("account-modal"),
            // Loader
            pageLoader: document.getElementById("page-loader"),
        };
    },

    addEventListeners() {
        this.dom.aiChatInput?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") this.sendAiMessage();
        });
        this.dom.terminalInput?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") this.executeTerminalCommand();
        });
    },

    async checkAuth() {
        let session = null;
        try {
            const stored = localStorage.getItem("coursera_user_session");
            session = stored ? JSON.parse(stored) : null;
        } catch (e) {
            session = null;
        }
        if (!session || !session.token) {
            this.showToast("Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.", "error");
            setTimeout(() => window.location.href = "login.html", 1500);
            throw new Error("Chưa đăng nhập");
        }
        this.state.token = session.token;
        try {
            const res = await fetch("dashboard.php", {
                headers: { Authorization: `Bearer ${this.state.token}` },
            });
            if (!res.ok) throw new Error("Failed to fetch user data");
            const data = await res.json();
            this.state.user = data.user;
            this.state.orders = data.orders;
        } catch (e) {
            console.error("Lỗi xác thực:", e);
            localStorage.removeItem("coursera_user_session");
            window.location.href = "login.html";
        }
    },

    async pollOrderUpdates() {
        if (
            !this.state.token ||
            (this.state.user && this.state.user.role === "admin")
        )
            return;
        try {
            const res = await fetch("dashboard.php", {
                headers: { Authorization: `Bearer ${this.state.token}` },
            });
            if (res.ok) {
                const data = await res.json();
                let newlyApprovedCourseId = null;

                // So sánh đơn hàng cũ và mới
                if (this.state.orders && this.state.orders.length > 0) {
                    data.orders.forEach((newOrder) => {
                        const oldOrder = this.state.orders.find(
                            (o) => o.id === newOrder.id,
                        );
                        if (
                            oldOrder &&
                            parseInt(oldOrder.current_step) === 1 &&
                            parseInt(newOrder.current_step) === 3
                        ) {
                            newlyApprovedCourseId = newOrder.course_name;
                        }
                    });
                }

                this.state.orders = data.orders;

                if (newlyApprovedCourseId) {
                    await this.loadData();
                    if (this.state.activeView === "dashboard") {
                        this.renderDashboardCourses();
                    }
                    this.updateUserInfoDisplay(); // Cập nhật lại Modal Lịch sử
                    this.showCongratulation(newlyApprovedCourseId);
                }
            }
        } catch (e) { }
    },

    async loadData() {
        try {
            const res = await fetch("courses.php", {
                headers: { Authorization: `Bearer ${this.state.token}` },
            });
            const data = await res.json();
            this.state.courses = data.courses || [];
        } catch (e) {
            console.error("Lỗi tải dữ liệu khóa học:", e);
            this.dom.coursesGrid.innerHTML = `<p class="text-red-500 text-center w-full">Không thể tải danh sách khóa học. Vui lòng kiểm tra kết nối tới backend.</p>`;
        }
    },

    // ========================================================
    // QUẢN LÝ GIAO DIỆN (UI/UX)
    // ========================================================
    renderSkeletonCards(count) {
        if (!this.dom.coursesGrid) return;
        this.dom.coursesGrid.innerHTML = "";
        let skeletonHTML = "";
        for (let i = 0; i < count; i++) {
            skeletonHTML += `
                <div class="course-card bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-gray-100 dark:border-slate-800 shadow-sm flex flex-col animate-pulse">
                    <div class="h-[180px] bg-gray-200 dark:bg-slate-800"></div>
                    <div class="p-6 flex-1 flex flex-col justify-between">
                        <div>
                            <div class="h-3 bg-gray-200 dark:bg-slate-800 rounded-full w-1/3 mb-4"></div>
                            <div class="h-5 bg-gray-200 dark:bg-slate-800 rounded-lg w-full mb-2"></div>
                            <div class="h-5 bg-gray-200 dark:bg-slate-800 rounded-lg w-4/5 mb-6"></div>
                            <div class="h-2 bg-gray-200 dark:bg-slate-800 rounded-full w-full mb-4"></div>
                            <div class="flex gap-2 mb-4">
                                <div class="h-6 bg-gray-200 dark:bg-slate-800 rounded-lg w-20"></div>
                                <div class="h-6 bg-gray-200 dark:bg-slate-800 rounded-lg w-20"></div>
                            </div>
                            <div class="h-6 bg-gray-200 dark:bg-slate-800 rounded-lg w-1/3 mt-2"></div>
                        </div>
                        <div class="mt-6 flex gap-2">
                            <div class="h-12 bg-gray-200 dark:bg-slate-800 rounded-xl flex-1"></div>
                            <div class="h-12 bg-gray-200 dark:bg-slate-800 rounded-xl w-12 shrink-0"></div>
                        </div>
                    </div>
                </div>`;
        }
        this.dom.coursesGrid.innerHTML = skeletonHTML;
    },

    renderLessonSkeleton() {
        if (this.dom.lessonMainTitle) {
            this.dom.lessonMainTitle.innerHTML = `<div class="h-8 bg-gray-200 dark:bg-slate-700 rounded w-2/3 animate-pulse"></div>`;
        }
        if (this.dom.lessonMainDesc) {
            this.dom.lessonMainDesc.innerHTML = `
                <div class="space-y-3 animate-pulse w-full">
                    <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
                    <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6"></div>
                    <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-4/6"></div>
                </div>
            `;
        }
        if (this.dom.videoWrapper) {
            this.dom.videoWrapper.innerHTML = `
                <div class="w-full h-full bg-gray-200 dark:bg-slate-800 animate-pulse flex items-center justify-center">
                    <i class="fa-solid fa-spinner fa-spin text-3xl text-gray-400 dark:text-gray-600"></i>
                </div>
            `;
        }
        if (this.dom.quizContainer) {
            this.dom.quizContainer.innerHTML = `
                <div class="quiz-question">
                    <div class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3" id="quiz-question-text">
                        <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2 animate-pulse"></div>
                    </div>
                    <div class="space-y-2" id="quiz-options-wrapper">
                        <div class="space-y-3 animate-pulse w-full">
                           <div class="h-12 bg-gray-200 dark:bg-slate-700 rounded-xl w-full"></div>
                           <div class="h-12 bg-gray-200 dark:bg-slate-700 rounded-xl w-full"></div>
                        </div>
                    </div>
                </div>
            `;
            // Cập nhật lại tham chiếu DOM sau khi ghi đè
            this.dom.quizQuestionText = document.getElementById("quiz-question-text");
            this.dom.quizOptionsWrapper = document.getElementById(
                "quiz-options-wrapper",
            );
        }
    },

    renderCategoryDropdown() {
        if (!this.dom.categoryList) return;
        this.dom.categoryList.innerHTML = "";
        
        const pillsContainer = document.getElementById('category-pills');
        if (pillsContainer) pillsContainer.innerHTML = "";

        if (this.state.courses.length === 0) {
            this.dom.categoryList.innerHTML = `<li class="px-4 py-3 text-sm text-gray-500 text-center col-span-full">Chưa có khóa học</li>`;
            return;
        }
        
        const staticCategories = ["Tất cả khóa học", "Bán chạy nhất"];
        const fragment = document.createDocumentFragment();

        staticCategories.forEach(category => {
            const catValue = category === "Tất cả khóa học" ? "all" : category;

            const li = document.createElement("li");
            li.innerHTML = `
                <a href="#" onclick="App.filterByCategory('${catValue}')" class="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-slate-700/50 transition-colors group">
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-300 group-hover:text-[#0056D2] dark:group-hover:text-blue-400 flex-1 truncate">${category}</span>
                </a>
            `;
            fragment.appendChild(li);

            if (pillsContainer) {
                let isActive = false;
                if (catValue === "all") isActive = this.state.searchQuery === "";
                else isActive = this.state.searchQuery === catValue.toLowerCase().trim();
                
                const btnClass = isActive ? "bg-[#0056D2] text-white border-[#0056D2] shadow-md shadow-blue-500/20" : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700/50";
                pillsContainer.innerHTML += `
                    <button onclick="App.filterByCategory('${catValue}')" class="shrink-0 px-6 py-2 rounded-full text-sm font-bold border ${btnClass} transition-all duration-200 whitespace-nowrap">
                        ${category}
                    </button>`;
    }
        });
        this.dom.categoryList.appendChild(fragment);
    },

    getCourseImage(course) {
        if (course.icon && typeof course.icon === 'string' && course.icon.trim() !== "" && course.icon !== "null") return course.icon;
        const defaultImages = [
            "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1510511459019-5d0502b3c20b?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1614064075525-e1f4dd5a203f?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1563206767-5b18f218e8de?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1515630278258-407f6ce22299?auto=format&fit=crop&w=800&q=80",
            "https://images.unsplash.com/photo-1526374865366-affd24ed2cc7?auto=format&fit=crop&w=800&q=80"
        ];
        let hash = 0; const idStr = String(course.id);
        for (let i = 0; i < idStr.length; i++) hash += idStr.charCodeAt(i);
        return defaultImages[hash % defaultImages.length];
    },

    renderDashboardCourses() {
        if (!this.dom.coursesGrid) return;

        let filteredCourses = this.state.courses;
        if (this.state.searchQuery) {
            filteredCourses = filteredCourses.filter((c) =>
                c.title.toLowerCase().includes(this.state.searchQuery) ||
                (c.badge && c.badge.toLowerCase().includes(this.state.searchQuery))
            );
        }

        const totalItems = filteredCourses.length;
        if (this.dom.courseCountText)
            this.dom.courseCountText.innerText = `Hiển thị ${totalItems} lộ trình`;

        this.dom.coursesGrid.innerHTML = "";

        if (totalItems === 0) {
            this.dom.coursesGrid.innerHTML = `<div class="w-full py-12 text-center text-gray-500 dark:text-gray-400 font-bold"><i class="fa-solid fa-box-open text-4xl mb-3 block opacity-50"></i>Không tìm thấy khóa học nào.</div>`;
            this.renderPaginationTabs(totalItems); // Thêm dòng này để xóa pagination khi không có kết quả
            return;
        }

        const paginatedCourses = filteredCourses.slice(
            (this.state.currentPage - 1) * this.state.itemsPerPage,
            this.state.currentPage * this.state.itemsPerPage,
        );

        const fragment = document.createDocumentFragment();

        paginatedCourses.forEach((course) => {
            const totalLessons = course.weeks.reduce(
                (sum, w) => sum + w.items.length,
                0,
            );
            const completedLessons = course.weeks.reduce(
                (sum, w) => sum + w.items.filter((i) => i.completed).length,
                0,
            );
            const progress =
                totalLessons > 0
                    ? Math.round((completedLessons / totalLessons) * 100)
                    : 0;

            const card = document.createElement("div");
            card.className =
                "course-card bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-gray-100 dark:border-slate-800/60 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1.5 transition-all duration-300 flex flex-col group/card";

            const isMyCourses = this.state.currentTab === "my_courses";

                 let actionButtonHTML = isMyCourses
                     ? `<button onclick="App.showLearningView('${course.id}')" class="w-full bg-blue-50 hover:bg-[#0056D2] dark:bg-blue-900/30 dark:hover:bg-[#0056D2] text-[#0056D2] hover:text-white dark:text-blue-400 dark:hover:text-white font-bold py-3 rounded-xl text-sm transition-all duration-300"><i class="fa-solid fa-play mr-1.5"></i> Vào học ngay</button>`
                     : `<div class="flex gap-2">
                         <button onclick="App.showLearningView('${course.id}', true)" class="flex-1 bg-[#0056D2] hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-sm transition-all shadow-[0_4px_14px_rgba(0,86,210,0.3)] hover:shadow-[0_6px_20px_rgba(0,86,210,0.4)]"><i class="fa-solid fa-graduation-cap mr-1.5"></i> Xem Khóa Học</button>
                         <button onclick="App.addToCart('${course.id}'); event.stopPropagation();" class="w-12 h-12 shrink-0 bg-blue-50 hover:bg-[#0056D2] dark:bg-slate-800 dark:hover:bg-[#0056D2] text-[#0056D2] hover:text-white dark:text-blue-400 dark:hover:text-white font-bold rounded-xl transition-all flex items-center justify-center border border-blue-100 dark:border-slate-700 hover:border-transparent"><i class="fa-solid fa-cart-plus"></i></button>
                        </div>`;
 
                 let clickAction = isMyCourses
                     ? `App.showLearningView('${course.id}')`
                     : `App.showLearningView('${course.id}', true)`;
                 
                 const imageUrl = this.getCourseImage(course);
                 const bgStyle = `background-image: url('${imageUrl}'); background-size: cover; background-position: center;`;
 
                 card.innerHTML = `
                     <div onclick="${clickAction}" class="relative cursor-pointer w-full shrink-0 overflow-hidden border-b border-gray-100 dark:border-slate-800" style="height: 180px;">
                         <div class="absolute inset-0 group-hover/card:scale-105 transition-transform duration-700 ease-out z-0" style="${bgStyle}"></div>
                         <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent z-0 opacity-80"></div>
                         <div class="absolute inset-0 bg-[#0056D2]/20 opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 z-0"></div>
                         <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all duration-300 backdrop-blur-sm z-10">
                             <span class="bg-white text-[#0056D2] font-bold px-6 py-2.5 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] transform translate-y-4 group-hover/card:translate-y-0 transition-transform duration-300 text-sm flex items-center gap-2">
                                 <i class="fa-solid ${isMyCourses ? "fa-play" : "fa-arrow-right"}"></i> ${isMyCourses ? "Vào bài giảng" : "Xem lộ trình"}
                             </span>
                         </div>
                         <div class="absolute top-3 left-3 z-20">
                             <span class="text-[10px] font-black uppercase tracking-wider bg-white/95 backdrop-blur text-[#0056D2] px-3 py-1.5 rounded-full shadow-sm">${course.badge || "Chuyên đề"}</span>
                         </div>
                     </div>
                     <div class="p-6 flex-1 flex flex-col bg-white dark:bg-slate-900 relative z-20">
                         <div class="flex-1 cursor-pointer flex flex-col" onclick="${clickAction}">
                             <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-2 font-bold uppercase tracking-wider flex items-center gap-1.5"><i class="fa-solid fa-shield-halved"></i> Coursera Advanced</div>
                             <h3 class="text-gray-900 dark:text-white font-black text-lg leading-snug group-hover/card:text-[#0056D2] dark:group-hover/card:text-blue-400 transition-colors line-clamp-2 mb-3" title="${course.title}">${course.title}</h3>
                             
                             <div class="mt-auto pt-2">
                                 <div class="flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                     <span>Tiến độ</span>
                                     <span class="text-[#0056D2] dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md">${progress}%</span>
                                 </div>
                                 <div class="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                     <div class="bg-gradient-to-r from-[#0056D2] to-blue-400 h-full transition-all duration-1000 ease-out" style="width: ${progress}%"></div>
                                 </div>
                                 
                                 <div class="mt-5 flex flex-wrap gap-2 text-[11px] font-bold text-gray-600 dark:text-gray-400">
                                     <span class="bg-gray-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-slate-700/50 flex items-center gap-1.5"><i class="fa-solid fa-layer-group text-gray-400"></i> ${course.weeks.length} Module</span>
                                     <span class="bg-gray-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-slate-700/50 flex items-center gap-1.5"><i class="fa-solid fa-certificate text-gray-400"></i> Chứng chỉ</span>
                                 </div>
                                 ${!isMyCourses ? `
                                 <div class="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800/50 flex items-end justify-between gap-2">
                                     <div class="flex flex-col">
                                         ${course.original_price > course.price ? `<span class="text-xs font-semibold text-gray-400 line-through mb-0.5">${Number(course.original_price).toLocaleString('vi-VN')} đ</span>` : ''}
                                         <span class="text-[#0056D2] dark:text-blue-400 font-black text-xl leading-none">${Number(course.price).toLocaleString('vi-VN')} đ</span>
                                     </div>
                                 </div>
                                 ` : ''}
                             </div>
                         </div>
                         <div class="mt-5 shrink-0">
                             ${actionButtonHTML}
                         </div>
                     </div>
                 `;
                 fragment.appendChild(card);
             });
             this.dom.coursesGrid.appendChild(fragment);
             this.renderPaginationTabs(totalItems);
         },
 
         showCatalogView() {
             this.state.activeView = "dashboard";
             this.state.currentPage = 1;
             this.dom.dashboardView.classList.remove("hidden");
             this.dom.learningView.classList.add("hidden");
             this.dom.btnBackToDashboard.classList.add("hidden");
             if (this.dom.heroSection) this.dom.heroSection.classList.remove("hidden");
             if (this.dom.mainSectionTitle)
                 this.dom.mainSectionTitle.innerHTML = "Khám phá lộ trình chuyên sâu";
             window.scrollTo({ top: 0, behavior: "smooth" });
             this.renderDashboardCourses();
         },
 
         showLearningView(courseId, forceLock = false) {
             this.state.activeView = "learning";
             this.state.currentItemRef.courseId = courseId;

        this.dom.dashboardView.classList.add("hidden");
        this.dom.learningView.classList.remove("hidden");
        this.dom.btnBackToDashboard.classList.remove("hidden");
        if (this.dom.heroSection) this.dom.heroSection.classList.add("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
        // Populate and set the course selector dropdown
        this.dom.courseSelector.innerHTML = "";
        const unlockedCourses = this.state.courses.filter(
            (c) => c.lock_status === "UNLOCKED",
        );
        unlockedCourses.forEach((c) => {
            const option = document.createElement("option");
            option.value = c.id;
            option.innerText = c.title;
            this.dom.courseSelector.appendChild(option);
        });
        const course = this.state.courses.find((c) => c.id === courseId);
        if (!course) {
            this.showToast("Lỗi: Không tìm thấy dữ liệu khóa học.", "error");
            this.showCatalogView();
            return;
        }
        // Always render the sidebar navigation to show the course content
        this.dom.courseSelector.value = courseId;
        this.dom.sidebarCourseTitle.innerText = course.title;
        this.renderCourseNavigation(
            course,
            forceLock || course.lock_status !== "UNLOCKED",
        );
        this.updateOverallProgress(course);
        // Check lock status to control the main content area
        if (course.lock_status === "UNLOCKED" && !forceLock) {
            const firstLesson = course.weeks?.[0]?.items?.[0];
            if (firstLesson) {
                this.loadLesson(firstLesson.id);
            } else {
                this.dom.lessonMainTitle.innerText = "Khóa học chưa có nội dung";
                this.dom.videoWrapper.innerHTML = `<div class="w-full h-full bg-black flex items-center justify-center text-gray-500">Chưa có bài giảng</div>`;
            }
        } else {
            // Giao diện cho khóa học bị Khóa / Chưa mua
            let overlayBtnHTML = "";
            let overlayTitle = "";
            let overlayDesc = "";

            if (course.lock_status === "UNLOCKED") {
                overlayBtnHTML = `<button onclick="openAccountModal('my_courses')" class="bg-[#0056D2] hover:bg-blue-700 text-white font-bold py-3 px-8 rounded transition-colors shadow-sm flex items-center gap-2 mx-auto mt-6">
                    <i class="fa-solid fa-user"></i> Vào Tài khoản để học
                   </button>`;
                overlayTitle = "Bạn đã sở hữu khóa học này";
                overlayDesc =
                    "Khóa học này đã được ghi danh thành công. Vui lòng truy cập vào phần Khóa học của bạn trong Tài khoản cá nhân để xem nội dung bài giảng.";
            } else {
                overlayBtnHTML = `<div class="flex items-center justify-center gap-2 mt-6">
                    <button onclick="App.openPaymentModal('${course.id}')" class="bg-[#0056D2] hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition-colors shadow-sm flex items-center gap-2">
                        Mua ngay - ${Number(course.price).toLocaleString('vi-VN')} đ
                    </button>
                    <button onclick="App.addToCart('${course.id}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[#0056D2] dark:text-blue-400 font-bold py-3 px-5 rounded-xl transition-colors border border-gray-200 dark:border-slate-700 flex items-center gap-2 shadow-sm" title="Thêm vào giỏ hàng">
                        <i class="fa-solid fa-cart-plus"></i>
                    </button>
                </div>`;
                overlayTitle = "Tham gia khóa học để mở khóa nội dung";
                overlayDesc =
                    "Ghi danh lộ trình này để truy cập toàn bộ bài giảng video, thực hành trên nền tảng Lab trực tuyến và nhận Chứng chỉ hoàn thành từ Coursera Advanced.";
            }

            const imageUrl = this.getCourseImage(course);
            const bgStyle = `background-image: url('${imageUrl}'); background-size: cover; background-position: center;`;
            const bgOverlay = `bg-white/95 dark:bg-[#0B0F19]/95 backdrop-blur-sm`;

            this.dom.lessonMainTitle.innerText = course.title;
            this.dom.videoWrapper.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-center p-8 text-center relative overflow-hidden" style="${bgStyle}">
                    <div class="absolute inset-0 ${bgOverlay}"></div>
                    <div class="relative z-10 max-w-lg mx-auto">
                        <div class="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 text-[#0056D2] dark:text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-100 dark:border-blue-800/30">
                            <i class="fa-solid fa-lock text-2xl"></i>
                        </div>
                        <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">${overlayTitle}</h3>
                        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">${overlayDesc}</p>
                        <div class="flex items-center justify-center gap-6 text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check text-green-500"></i> ${course.weeks.length} Module chuyên sâu</span>
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check text-green-500"></i> Lab thực chiến</span>
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check text-green-500"></i> Cấp chứng chỉ</span>
                        </div>
                        ${overlayBtnHTML}
                    </div>
                </div>
            `;
            // Hide all tabs and show a generic message
            this.dom.tabContents.forEach((el) => el.classList.add("hidden"));
            this.dom.lessonMainDesc.innerHTML = `<p class="text-gray-500">Bạn cần ghi danh khóa học để xem thông tin chi tiết các bài học và tài liệu.</p>`;
        }
    },

    renderCourseNavigation(course, isLocked = false) {
        this.dom.courseNavigation.innerHTML = "";
        const fragment = document.createDocumentFragment();

        course.weeks.forEach((week) => {
            const weekEl = document.createElement("div");
            weekEl.innerHTML = `<p class="px-4 pt-3 pb-1 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tuần ${week.week_number}: ${week.title}</p>`;
            const ul = document.createElement("ul");
            ul.className = "px-2 space-y-0.5";

            week.items.forEach((item) => {
                const li = document.createElement("li");
                const iconClass =
                    item.type === "video" ? "fa-circle-play" : "fa-microchip";
                const completedClass = item.completed
                    ? "text-green-500 dark:text-green-400"
                    : "text-gray-400 dark:text-gray-500";
                const activeClass =
                    !isLocked && item.id === this.state.currentItemRef.lessonId
                        ? "bg-blue-50 dark:bg-slate-800"
                        : "";
                const clickAction = isLocked
                    ? `event.preventDefault()`
                    : `App.loadLesson('${item.id}')`;
                const cursorClass = isLocked
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-gray-100 dark:hover:bg-slate-800";

                li.innerHTML = `
                    <a href="#" onclick="${clickAction}" id="nav-item-${item.id}" class="flex items-start gap-3 p-2.5 rounded-xl text-xs font-bold transition-colors ${activeClass} ${cursorClass}">
                        <i class="fa-solid ${iconClass} mt-0.5 w-4 text-center ${completedClass}"></i>
                        <span class="flex-1 text-gray-800 dark:text-gray-200 leading-snug">${item.title}</span>
                    </a>
                `;
                ul.appendChild(li);
            });
            weekEl.appendChild(ul);
            fragment.appendChild(weekEl);
        });

        // Add certificate button if course is 100% complete
        const totalLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.length,
            0,
        );
        const completedLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.filter((i) => i.completed).length,
            0,
        );
        const progress =
            totalLessons > 0
                ? Math.round((completedLessons / totalLessons) * 100)
                : 0;

        if (!isLocked && progress === 100) {
            const certButton = document.createElement("div");
            certButton.className = "p-4 flex flex-col gap-2.5";
            certButton.innerHTML = `
                <button onclick="App.downloadCertificate('${course.id}')" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2"><i class="fa-solid fa-award"></i> Nhận Chứng Chỉ</button>
                <button onclick="App.openReviewModal('${course.id}')" class="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2.5 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2"><i class="fa-solid fa-star"></i> Đánh giá khóa học</button>
            `;
            fragment.appendChild(certButton);
        }
        this.dom.courseNavigation.appendChild(fragment);
    },

    async loadLesson(lessonId) {
        const course = this.state.courses.find(
            (c) => c.id === this.state.currentItemRef.courseId,
        );
        if (!course) return;

        let lesson = null;
        for (const week of course.weeks) {
            const found = week.items.find((i) => i.id === lessonId);
            if (found) {
                lesson = found;
                break;
            }
        }

        if (!lesson) {
            this.showToast("Lỗi: Không tìm thấy bài học.", "error");
            return;
        }

        this.state.currentItemRef.lessonId = lessonId;

        this.renderLessonSkeleton();
        await new Promise((r) => setTimeout(r, 400)); // Tạo độ trễ ảo 400ms để hiệu ứng khung xương xuất hiện

        if (this.state.currentItemRef.lessonId !== lessonId) return; // Chống ghi đè nếu học viên bấm nhanh bài khác

        this.dom.lessonMainTitle.innerText = lesson.title;
        this.dom.lessonMainDesc.innerHTML =
            lesson.description || "Chưa có mô tả cho bài học này.";

        document
            .querySelectorAll('[id^="nav-item-"]')
            .forEach((el) => el.classList.remove("bg-blue-50", "dark:bg-slate-800"));
        document
            .getElementById(`nav-item-${lessonId}`)
            ?.classList.add("bg-blue-50", "dark:bg-slate-800");

        if (lesson.videoSrc) {
            let videoUrl = lesson.videoSrc;
            if (videoUrl.toLowerCase().endsWith('.mp4') || videoUrl.toLowerCase().endsWith('.webm')) {
                this.dom.videoWrapper.innerHTML = `<video controls autoplay class="w-full h-full bg-black object-contain"><source src="${videoUrl}" type="video/mp4">Trình duyệt không hỗ trợ thẻ video.</video>`;
            } else if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
                this.dom.videoWrapper.innerHTML = `<iframe src="${videoUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>`;
            } else {
                this.dom.videoWrapper.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoUrl}?autoplay=1&rel=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>`;
            }
        } else {
            this.dom.videoWrapper.innerHTML = `<div class="w-full h-full bg-black flex items-center justify-center text-gray-500 font-bold">Bài học không có video</div>`;
        }

        this.renderQuiz(lesson.quiz);
        this.switchTab(lesson.quiz ? "quiz" : "slides");

        if (!lesson.completed) {
            lesson.completed = true;
            this.updateOverallProgress(course);
            this.renderCourseNavigation(course);
            try {
                await fetch("student_api.php/progress", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${this.state.token}`,
                    },
                    body: JSON.stringify({ lesson_id: lessonId }),
                });
            } catch (e) {
                console.error("Lỗi lưu tiến trình:", e);
            }
        }
    },

    switchCourse(courseId) {
        // This function is called by the onchange event of the course selector
        this.showLearningView(courseId);
    },

    updateOverallProgress(course) {
        const totalLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.length,
            0,
        );
        const completedLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.filter((i) => i.completed).length,
            0,
        );
        const progress =
            totalLessons > 0
                ? Math.round((completedLessons / totalLessons) * 100)
                : 0;

        this.dom.overallProgressText.innerText = `${progress}%`;
        this.dom.overallProgress.style.width = `${progress}%`;
    },

    updateUserInfoDisplay() {
        if (this.state.user) {
            this.dom.userFullnameDisplay.innerText = this.state.user.fullname;
            this.dom.userEmailDisplay.innerText = this.state.user.email;

            // Tự động tạo Avatar dựa trên tên của học viên (Màu nền xanh chuẩn Coursera)
            const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(this.state.user.fullname)}&background=0056D2&color=fff&rounded=true&bold=true`;
            const headerAvatar = document.getElementById("header-avatar");
            const dropdownAvatar = document.getElementById("dropdown-avatar");
            
            if (headerAvatar) headerAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="w-full h-full rounded-full object-cover">`;
            if (dropdownAvatar) dropdownAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="w-full h-full rounded-full object-cover">`;

            const adminMenuItem = document.getElementById("admin-menu-item");
            if (adminMenuItem) {
                if (
                    this.state.user.role === "admin" ||
                    this.state.user.role === "teacher"
                ) {
                    adminMenuItem.classList.remove("hidden");
                }
            }
        }
    },

    // ========================================================
    // XỬ LÝ TƯƠNG TÁC
    // ========================================================
    toggleSidebar() {
        this.dom.sidebar.classList.toggle("-translate-x-full");
        this.dom.sidebarBackdrop.classList.toggle("hidden");
    },

    toggleTheme() {
        const isDark = document.documentElement.classList.toggle("dark");
        this.state.theme = isDark ? "dark" : "light";
        localStorage.setItem("theme", this.state.theme);
    },

    applyInitialTheme() {
        const savedTheme = localStorage.getItem("theme") || "dark";
        this.state.theme = savedTheme;
        if (savedTheme === "dark") {
            document.documentElement.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
        }
    },

    handleHeaderSearch(e) {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            const val = e.target.value.toLowerCase().trim();
            if (this.state.searchQuery === val) return; // Bỏ qua nếu không thay đổi
            
            this.state.searchQuery = val;
            this.state.currentPage = 1;
            
            if (this.state.activeView !== "dashboard") {
                this.showCatalogView();
            } else {
                requestAnimationFrame(() => this.renderDashboardCourses()); // Ép GPU render mượt
            }
            
            if (this.state.activeView === "dashboard" && val.length > 0) {
                this.dom.coursesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 150); // Độ trễ 150ms cực nhỏ để chống giật lag
    },

    filterByCategory(category) {
        if (category === 'all') {
            this.state.searchQuery = "";
            if (this.dom.headerSearchInput) this.dom.headerSearchInput.value = "";
        } else {
            this.state.searchQuery = category.toLowerCase().trim();
            if (this.dom.headerSearchInput) this.dom.headerSearchInput.value = category;
        }
        this.state.currentPage = 1;
        
        this.renderCategoryDropdown(); // Cập nhật lại màu sắc của nút đang chọn
        if (this.state.activeView !== "dashboard") {
            this.showCatalogView();
        } else {
            this.renderDashboardCourses();
        }
    },

    searchFromMarquee(keyword) {
        if (this.dom.searchInput) {
            this.dom.searchInput.value = keyword;
            this.state.searchQuery = keyword.toLowerCase().trim();
            this.state.currentPage = 1;
            this.renderDashboardCourses();

            // Cuộn trang xuống khu vực tìm kiếm mượt mà và focus vào ô input
            this.dom.searchInput.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
            setTimeout(() => this.dom.searchInput.focus(), 500);
        }
    },

    switchSidebarTab(tabId) {
        const chatWrapper = document.getElementById("ai-chat-wrapper");
        const terminalWrapper = document.getElementById("terminal-wrapper");
        const chatBtn = document.getElementById("sidebar-tab-btn-chat");
        const terminalBtn = document.getElementById("sidebar-tab-btn-terminal");

        if (tabId === "chat") {
            chatWrapper.classList.remove("hidden");
            terminalWrapper.classList.add("hidden");
            chatBtn.classList.add(
                "bg-white",
                "dark:bg-[#0D1117]",
                "text-[#0056D2]",
                "dark:text-blue-400",
                "shadow-sm",
            );
            chatBtn.classList.remove("text-gray-500");
            terminalBtn.classList.remove(
                "bg-white",
                "dark:bg-[#0D1117]",
                "text-[#0056D2]",
                "dark:text-blue-400",
                "shadow-sm",
            );
            terminalBtn.classList.add("text-gray-500");
        } else {
            terminalWrapper.classList.remove("hidden");
            chatWrapper.classList.add("hidden");
            terminalBtn.classList.add(
                "bg-white",
                "dark:bg-[#0D1117]",
                "text-[#0056D2]",
                "dark:text-blue-400",
                "shadow-sm",
            );
            terminalBtn.classList.remove("text-gray-500");
            chatBtn.classList.remove(
                "bg-white",
                "dark:bg-[#0D1117]",
                "text-[#0056D2]",
                "dark:text-blue-400",
                "shadow-sm",
            );
            chatBtn.classList.add("text-gray-500");
        }
    },

    switchTab(tabId) {
        this.dom.tabContents.forEach((el) => el.classList.add("hidden"));
        this.dom.tabButtons.forEach((el) =>
            el.classList.remove(
                "border-[#0056D2]",
                "text-[#0056D2]",
                "dark:text-blue-400",
            ),
        );
        this.dom.tabButtons.forEach((el) =>
            el.classList.add("border-transparent", "text-gray-500"),
        );

        document.getElementById(`tab-content-${tabId}`)?.classList.remove("hidden");
        document
            .getElementById(`tab-btn-${tabId}`)
            ?.classList.add(
                "border-[#0056D2]",
                "text-[#0056D2]",
                "dark:text-blue-400",
            );
        document
            .getElementById(`tab-btn-${tabId}`)
            ?.classList.remove("border-transparent", "text-gray-500");
    },

    renderQuiz(quizData) {
        if (!quizData || !this.dom.quizContainer) {
            this.dom.quizContainer.innerHTML = `<p class="text-gray-500">Bài học này không có câu hỏi trắc nghiệm.</p>`;
            return;
        }

        // Phục hồi lại cấu trúc HTML nếu nó đã bị ghi đè bởi bài học không có Quiz trước đó
        this.dom.quizContainer.innerHTML = `
            <div class="quiz-question">
                <div class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3" id="quiz-question-text"></div>
                <div class="space-y-2" id="quiz-options-wrapper"></div>
            </div>
        `;
        this.dom.quizQuestionText = document.getElementById("quiz-question-text");
        this.dom.quizOptionsWrapper = document.getElementById(
            "quiz-options-wrapper",
        );

        this.dom.quizQuestionText.innerText = quizData.question;
        this.dom.quizOptionsWrapper.innerHTML = "";
        quizData.options.forEach((opt) => {
            this.dom.quizOptionsWrapper.innerHTML += `
                <label class="flex items-center p-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 cursor-pointer hover:border-[#0056D2] has-[:checked]:border-[#0056D2] has-[:checked]:ring-2 has-[:checked]:ring-[#0056D2]/20">
                    <input type="radio" name="quiz_option" value="${opt.v}" class="h-4 w-4 text-[#0056D2] focus:ring-[#0056D2] border-gray-300">
                    <span class="ml-3 text-sm font-semibold text-gray-700 dark:text-gray-300">${opt.t}</span>
                </label>
            `;
        });
        this.dom.quizResult.classList.add("hidden");
    },

    async submitQuiz() {
        const selectedOption = document.querySelector(
            'input[name="quiz_option"]:checked',
        );
        if (!selectedOption) {
            this.showToast("Vui lòng chọn một đáp án!", "warning");
            return;
        }

        const course = this.state.courses.find(
            (c) => c.id === this.state.currentItemRef.courseId,
        );
        const lesson = course?.weeks
            .flatMap((w) => w.items)
            .find((i) => i.id === this.state.currentItemRef.lessonId);

        if (!lesson || !lesson.quiz) {
            this.showToast("Lỗi: Không tìm thấy dữ liệu quiz.", "error");
            return;
        }

        this.dom.quizResult.classList.remove(
            "hidden",
            "border-green-500",
            "text-green-600",
            "bg-green-50",
            "border-red-500",
            "text-red-600",
            "bg-red-50",
        );

        if (selectedOption.value === lesson.quiz.correct) {
            this.dom.quizResult.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i> Chính xác! Bạn đã trả lời đúng.`;
            this.dom.quizResult.classList.add(
                "border-green-500",
                "text-green-600",
                "bg-green-50",
                "dark:bg-green-900/20",
                "dark:text-green-400",
            );
            this.playSound("sounds/correct.mp3");
        } else {
            this.dom.quizResult.innerHTML = `<i class="fa-solid fa-times-circle mr-2"></i> Không chính xác. Vui lòng xem lại bài giảng.`;
            this.dom.quizResult.classList.add(
                "border-red-500",
                "text-red-600",
                "bg-red-50",
                "dark:bg-red-900/20",
                "dark:text-red-400",
            );
        }
    },

    async sendAiMessage() {
        const input = this.dom.aiChatInput;
        const message = input.value.trim();
        if (!message) return;

        // Hiển thị tin nhắn của người dùng
        this.dom.aiChatLog.innerHTML += `
            <div class="flex justify-end">
                <div class="bg-[#0056D2] text-white text-sm font-medium p-3 rounded-2xl rounded-br-none max-w-xs lg:max-w-sm">
                    ${message}
                </div>
            </div>
        `;
        input.value = "";
        this.playSound("sounds/ping.mp3");
        this.dom.aiChatLog.scrollTop = this.dom.aiChatLog.scrollHeight;

        // Hiển thị trạng thái "AI đang gõ..."
        const thinkingElId = `thinking-${Date.now()}`;
        this.dom.aiChatLog.innerHTML += `
            <div id="${thinkingElId}" class="flex justify-start">
                <div class="bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-200 text-sm font-medium p-3 rounded-2xl rounded-bl-none max-w-xs lg:max-w-sm">
                    <i class="fa-solid fa-circle-notch fa-spin text-xs"></i>
                </div>
            </div>
        `;
        this.dom.aiChatLog.scrollTop = this.dom.aiChatLog.scrollHeight;

        try {
            const res = await fetch("student_api.php/chatbot", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify({
                    message: message,
                    course_id: this.state.currentItemRef.courseId,
                }),
            });
            const data = await res.json();

            // Thay thế "đang gõ" bằng câu trả lời thật
            const thinkingEl = document.getElementById(thinkingElId);
            if (thinkingEl)
                thinkingEl.querySelector("div").innerHTML = data.reply.replace(
                    /\n/g,
                    "<br>",
                );
        } catch (e) {
            const thinkingEl = document.getElementById(thinkingElId);
            if (thinkingEl)
                thinkingEl.querySelector("div").innerHTML =
                    "Lỗi kết nối tới CyberAI. Vui lòng thử lại.";
            console.error("Lỗi chat AI:", e);
        } finally {
            this.dom.aiChatLog.scrollTop = this.dom.aiChatLog.scrollHeight;
        }
    },

    async executeTerminalCommand() {
        const input = this.dom.terminalInput;
        const command = input.value.trim();
        if (!command) return;

        // Hiển thị lại lệnh đã gõ
        this.dom.terminalHistory.innerHTML += `
            <div class="flex items-center gap-2">
                <span class="text-slate-500 font-bold">root@kali:~#</span>
                <span class="text-white">${command}</span>
            </div>
        `;
        input.value = "";

        // Xử lý lệnh
        let output = "";
        const cmdParts = command.split(" ");
        const mainCmd = cmdParts[0].toLowerCase();

        if (mainCmd === "help") {
            output = `Coursera Secure Sandbox v1.0\nAvailable commands:\n  <span class="text-yellow-400">help</span>     - Show this help message\n  <span class="text-yellow-400">scan</span>     - Scan for open ports (mock)\n  <span class="text-yellow-400">submit</span>   - Submit a CTF flag\n  <span class="text-yellow-400">clear</span>    - Clear the terminal screen`;
        } else if (mainCmd === "submit") {
            if (cmdParts.length > 1) {
                const flag = cmdParts.slice(1).join(" ");
                output = await this.submitFlag(flag);
            } else {
                output = `Usage: submit &lt;flag_string&gt;\nExample: submit COURSERA{...}`;
            }
        } else if (mainCmd === "scan") {
            output = `Scanning target 10.0.2.15...\n\nPORT   STATE SERVICE\n22/tcp open  ssh\n80/tcp open  http\n\nScan finished.`;
        } else if (mainCmd === "clear") {
            this.resetTerminalConsole();
            return; // Không cần render output
        } else {
            output = `bash: command not found: ${command}`;
        }

        this.dom.terminalHistory.innerHTML += `<div>${output.replace(/\n/g, "<br>")}</div>`;
        document.getElementById("terminal-scroll-box").scrollTop =
            document.getElementById("terminal-scroll-box").scrollHeight;
    },

    async submitFlag(flag) {
        if (!this.state.currentItemRef.lessonId)
            return "Error: No lesson selected. Cannot submit flag.";
        try {
            const res = await fetch("student_api.php/submit-flag", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify({
                    lesson_id: this.state.currentItemRef.lessonId,
                    flag: flag,
                }),
            });
            const data = await res.json();
            if (data.success) {
                await this.loadData();
                const course = this.state.courses.find(
                    (c) => c.id === this.state.currentItemRef.courseId,
                );
                this.renderCourseNavigation(course);
                this.updateOverallProgress(course);
            }
            return data.message;
        } catch (e) {
            console.error("Lỗi nộp flag:", e);
            return "Error connecting to the flag submission server.";
        }
    },

    resetTerminalConsole() {
        if (this.dom.terminalHistory) this.dom.terminalHistory.innerHTML = "";
    },

    addToCart(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;
        if (course.lock_status === "UNLOCKED") {
            this.showToast("Bạn đã sở hữu khóa học này rồi!", "warning");
            return;
        }
        if (!this.state.cart.includes(courseId)) {
            this.state.cart.push(courseId);
            this.updateCartBadge();
            this.playSound("sounds/ping.mp3");
            this.renderCart(); 
            
            const toast = document.createElement("div");
            toast.className = "fixed top-24 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-full font-bold shadow-lg z-[9999] animate-fade-in-up text-sm flex items-center gap-2";
            toast.innerHTML = `<i class="fa-solid fa-cart-plus"></i> Đã thêm vào giỏ hàng`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.classList.add("opacity-0", "transition-opacity");
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        } else {
            this.showToast("Khóa học này đã có trong giỏ hàng!", "warning");
        }
    },

    removeFromCart(courseId) {
        this.state.cart = this.state.cart.filter(id => id !== courseId);
        this.updateCartBadge();
        this.renderCart();
    },

    updateCartBadge() {
        const badge = document.getElementById("cart-badge");
        if (!badge) return;
        if (this.state.cart.length > 0) {
            badge.innerText = this.state.cart.length;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    },

    toggleCartModal() {
        const modal = document.getElementById("cart-modal");
        if (!modal) return;
        if (modal.classList.contains("hidden")) {
            this.renderCart();
            modal.classList.remove("hidden");
        } else {
            modal.classList.add("hidden");
        }
    },

    renderCart() {
        const container = document.getElementById("cart-items-container");
        const totalEl = document.getElementById("cart-total-price");
        if (!container || !totalEl) return;

        container.innerHTML = "";
        let total = 0;

        if (this.state.cart.length === 0) {
            container.innerHTML = `<div class="text-center py-8 text-gray-500 font-bold"><i class="fa-solid fa-cart-arrow-down text-4xl mb-3 block opacity-30"></i> Giỏ hàng đang trống</div>`;
            totalEl.innerText = "0 đ";
            return;
        }

        this.state.cart.forEach(courseId => {
            const course = this.state.courses.find(c => c.id === courseId);
            if (!course) return;
            total += parseInt(course.price);

            container.innerHTML += `
                <div class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                    <div class="w-16 h-12 bg-gray-200 dark:bg-slate-700 rounded-lg bg-cover bg-center shrink-0" style="background-image: url('${this.getCourseImage(course)}');"></div>
                    <div class="flex-1 min-w-0">
                        <h4 class="font-bold text-sm text-gray-900 dark:text-white truncate" title="${course.title}">${course.title}</h4>
                        <p class="text-[#0056D2] dark:text-blue-400 font-black text-sm mt-0.5">${Number(course.price).toLocaleString("vi-VN")} đ</p>
                    </div>
                    <button onclick="App.removeFromCart('${course.id}')" class="w-8 h-8 rounded-full bg-red-50 hover:bg-red-100 text-red-500 dark:bg-red-900/20 dark:text-red-400 flex items-center justify-center shrink-0 transition-colors"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>
            `;
        });

        totalEl.innerText = `${Number(total).toLocaleString("vi-VN")} đ`;
    },

    async openPaymentModal(courseId) {
        const payCourseTitleEl = document.getElementById("pay-course-title");
        const payPriceEl = document.getElementById("pay-price");
        const btnConfirm = document.getElementById("btn-confirm-mock-pay");

        document.getElementById("pay-qr-img").src = "";
        document.getElementById("pay-memo").innerText = "Đang tạo mã...";

        // Reset discount UI
        const discountInput = document.getElementById("discount-code-input");
        const discountMsg = document.getElementById("discount-message");
        if (discountInput) { 
            discountInput.value = ""; 
            discountInput.parentElement.parentElement.classList.remove("hidden"); 
        }
        if (discountMsg) discountMsg.classList.add("hidden");

        this.dom.paymentModal.classList.remove("hidden");

        const course = this.state.courses.find((c) => c.id === courseId);
        if (!course) {
            this.showToast("Lỗi: Không tìm thấy khóa học để thanh toán.", "error");
            closePaymentModal();
            return;
        }
        const url = "student_api.php/checkout";
        const body = { course_id: courseId };
        payCourseTitleEl.innerText = course.title;

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.ok) {
                document.getElementById("pay-qr-img").src = data.qr_url;
                document.getElementById("pay-memo").innerText = data.memo;
                payPriceEl.innerText = `${Number(data.price).toLocaleString("vi-VN")} đ`;
                btnConfirm.dataset.orderId = data.order_id; // Lưu order_id để dùng cho webhook
                btnConfirm.dataset.courseId = courseId;
                btnConfirm.dataset.isCart = "false";
            } else {
                this.showToast(data.message || "Lỗi tạo thanh toán", "error");
                closePaymentModal();
            }
        } catch (e) {
            this.showToast("Lỗi kết nối khi tạo mã thanh toán.", "error");
            closePaymentModal();
        }
    },

    async checkoutCart() {
        if (this.state.cart.length === 0) { this.showToast("Giỏ hàng đang trống!", "warning"); return; }
        this.toggleCartModal();
        
        const payCourseTitleEl = document.getElementById("pay-course-title");
        const payPriceEl = document.getElementById("pay-price");
        const btnConfirm = document.getElementById("btn-confirm-mock-pay");

        document.getElementById("pay-qr-img").src = "";
        document.getElementById("pay-memo").innerText = "Đang tạo mã...";

        const discountInput = document.getElementById("discount-code-input");
        if (discountInput) {
            discountInput.value = "";
            discountInput.parentElement.parentElement.classList.remove("hidden"); 
        }

        this.dom.paymentModal.classList.remove("hidden");
        payCourseTitleEl.innerText = `Thanh toán giỏ hàng (${this.state.cart.length} khóa)`;

        try {
            const res = await fetch("student_api.php/cart-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.state.token}` },
                body: JSON.stringify({ course_ids: this.state.cart }),
            });
            const data = await res.json();
            if (res.ok) {
                document.getElementById("pay-qr-img").src = data.qr_url;
                document.getElementById("pay-memo").innerText = data.memo;
                payPriceEl.innerText = `${Number(data.price).toLocaleString("vi-VN")} đ`;
                btnConfirm.dataset.orderId = data.order_id;
                btnConfirm.dataset.isCart = "true";
            } else { this.showToast(data.message || "Lỗi tạo thanh toán", "error"); closePaymentModal(); }
        } catch (e) { this.showToast("Lỗi kết nối khi tạo mã thanh toán.", "error"); closePaymentModal(); }
    },

    async applyDiscount() {
        const inputEl = document.getElementById("discount-code-input");
        const msgEl = document.getElementById("discount-message");
        const btnConfirm = document.getElementById("btn-confirm-mock-pay");
        const qrImg = document.getElementById("pay-qr-img");
        const qrOverlay = document.getElementById("qr-loading-overlay");
        const priceEl = document.getElementById("pay-price");
        const orderId = btnConfirm.dataset.orderId;

        const code = inputEl.value.trim();
        if (!code) return;

        // Hiệu ứng Loading cho QR Code và Giá
        if (qrOverlay) qrOverlay.classList.remove("hidden");
        qrImg.style.opacity = "0.3";
        priceEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-gray-400"></i>`;

        msgEl.classList.remove(
            "hidden",
            "text-green-600",
            "dark:text-green-400",
            "text-red-500",
            "dark:text-red-400",
        );
        msgEl.classList.add("text-gray-500");
        msgEl.innerText = "Đang kiểm tra...";

        try {
            const res = await fetch("apply_discount.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify({ order_id: orderId, code: code }),
            });
            const data = await res.json();

            if (res.ok) {
                msgEl.innerText = data.message;
                msgEl.classList.remove("text-gray-500");
                msgEl.classList.add("text-green-600", "dark:text-green-400");

                priceEl.innerHTML = `<span class="line-through text-gray-400 dark:text-gray-500 font-medium text-xs md:text-sm mr-2">${Number(data.original_price).toLocaleString("vi-VN")} đ</span><span class="text-green-600 dark:text-green-400">${Number(data.new_price).toLocaleString("vi-VN")} đ</span>`;
                
                // Cập nhật ảnh QR mượt mà
                qrImg.onload = () => {
                    qrImg.style.opacity = "1";
                    if (qrOverlay) qrOverlay.classList.add("hidden");
                };
                qrImg.src = data.qr_url;
                
            } else {
                msgEl.innerText = data.message;
                msgEl.classList.remove("text-gray-500");
                msgEl.classList.add("text-red-500", "dark:text-red-400");
                priceEl.innerHTML = `Lỗi`;
                qrImg.style.opacity = "1";
                if (qrOverlay) qrOverlay.classList.add("hidden");
            }
        } catch (e) {
            msgEl.innerText = "Lỗi kết nối máy chủ.";
            msgEl.classList.remove("text-gray-500");
            msgEl.classList.add("text-red-500", "dark:text-red-400");
            priceEl.innerHTML = `Lỗi`;
            qrImg.style.opacity = "1";
            if (qrOverlay) qrOverlay.classList.add("hidden");
        }
    },

    async confirmMockPayment() {
        const btn = document.getElementById("btn-confirm-mock-pay");
        const orderId = btn.dataset.orderId;
        const isCart = btn.dataset.isCart === "true";
        const courseId = btn.dataset.courseId;

        if (!orderId) {
            this.showToast("Lỗi: Không tìm thấy mã khóa học để xác nhận.", "error");
            return;
        }

        let url = "";
        let body = {};

        if (isCart) {
            url = "student_api.php/mock-webhook-cart";
            body = { order_id: orderId };
        } else {
            url = "student_api.php/mock-webhook";
            body = { order_id: orderId };
        }

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            this.showToast(data.message, res.ok ? "success" : "error");
            if (res.ok) {
                closePaymentModal();
                btn.dataset.orderId = ""; // Reset dataset
                btn.dataset.courseId = "";
                btn.dataset.isCart = "false";
                
                if (isCart) {
                    this.state.cart = []; // Xóa giỏ hàng
                    this.updateCartBadge();
                }
                
                await this.loadData();
                this.renderDashboardCourses();
                // Cập nhật lại giao diện người dùng để hiện đơn hàng chờ duyệt
                this.checkAuth().then(() => this.updateUserInfoDisplay());
            }
        } catch (e) {
            this.showToast("Lỗi xác nhận thanh toán.", "error");
        }
    },

    renderPaginationTabs(totalItems) {
        if (!this.dom.paginationContainer) return;
        this.dom.paginationContainer.innerHTML = "";
        const totalPages = Math.ceil(totalItems / this.state.itemsPerPage);

        if (totalPages <= 1) return;

        for (let i = 1; i <= totalPages; i++) {
            const isActive = i === this.state.currentPage;
            const button = document.createElement("button");
            button.innerText = i;
            button.onclick = () => this.changePage(i);

            let baseClasses =
                "w-9 h-9 rounded-xl text-xs font-bold transition-colors ";
            if (isActive) {
                button.className =
                    baseClasses + "bg-[#0056D2] text-white shadow-md cursor-default";
            } else {
                button.className =
                    baseClasses +
                    "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700";
            }
            this.dom.paginationContainer.appendChild(button);
        }
    },

    changePage(pageNumber) {
        this.state.currentPage = pageNumber;
        this.renderDashboardCourses();
        window.scrollTo({ top: 0, behavior: "smooth" });
    },

    openReviewModal(courseId) {
        this.state.currentRating = 0;
        this.setRating(0); // Reset số sao
        document.getElementById("review-course-id").value = courseId;
        document.getElementById("review-text").value = "";

        const modal = document.getElementById("review-modal");
        if (modal) {
            modal.classList.remove("hidden");
            setTimeout(() => modal.classList.remove("opacity-0"), 10);
        }
    },

    setRating(stars) {
        this.state.currentRating = stars;
        const starContainer = document.getElementById("star-rating-container");
        if (!starContainer) return;

        const starIcons = starContainer.querySelectorAll("i");
        starIcons.forEach((icon, index) => {
            if (index < stars) {
                icon.classList.remove("text-gray-300", "dark:text-gray-600");
                icon.classList.add("text-yellow-400");
            } else {
                icon.classList.remove("text-yellow-400");
                icon.classList.add("text-gray-300", "dark:text-gray-600");
            }
        });
    },

    async submitReview(e) {
        e.preventDefault();
        if (this.state.currentRating === 0) {
            this.showToast("Vui lòng chọn số sao đánh giá!", "warning");
            return;
        }
        const courseId = document.getElementById("review-course-id").value;
        const text = document.getElementById("review-text").value;
        const btn = document.getElementById("submit-review-btn");

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML =
            '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang gửi...';
        try {
            const res = await fetch("student_api.php/review", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.state.token}`,
                },
                body: JSON.stringify({
                    course_id: courseId,
                    rating: this.state.currentRating,
                    comment: text,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                this.showToast(data.message || "Cảm ơn bạn đã đánh giá khóa học!", "success");
                closeReviewModal();
            } else {
                this.showToast(data.message || "Có lỗi xảy ra.", "error");
            }
        } catch (err) {
            this.showToast("Lỗi kết nối tới máy chủ.", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },

    async downloadCertificate(courseId) {
        const course = this.state.courses.find((c) => c.id === courseId);
        if (!course) {
            this.showToast("Không tìm thấy khóa học!", "error");
            return;
        }

        const totalLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.length,
            0,
        );
        const completedLessons = course.weeks.reduce(
            (sum, w) => sum + w.items.filter((i) => i.completed).length,
            0,
        );
        const progress =
            totalLessons > 0
                ? Math.round((completedLessons / totalLessons) * 100)
                : 0;

        if (progress < 100) {
            this.showToast(`Bạn cần hoàn thành 100% khóa học để nhận chứng chỉ. Tiến độ hiện tại: ${progress}%`, "warning");
            return;
        }

        // Mở trang chứng chỉ PDF trên tab mới với token xác thực
        const url = `student_api.php/certificate/${courseId}?token=${this.state.token}`;
        window.open(url, '_blank');
        this.showToast("Hệ thống đang tải Chứng chỉ PDF của bạn...", "success");
    },

    downloadPdf() {
        this.showToast("Tính năng đang được phát triển. Tài liệu sẽ sớm được cập nhật!", "info");
    },

    playSound(soundUrl) {
        // Tối ưu hóa: Lưu vào bộ nhớ đệm (cache) để âm thanh phát ngay lập tức
        if (!this.audioCache) this.audioCache = {};
        if (!this.audioCache[soundUrl]) {
            this.audioCache[soundUrl] = new Audio(soundUrl);
        }
        // Nhân bản (clone) âm thanh để cho phép phát đè nếu thao tác liên tục
        this.audioCache[soundUrl]
            .cloneNode()
            .play()
            .catch((e) => console.error("Lỗi phát âm thanh:", e));
    },

    hidePageLoader() {
        if (this.dom.pageLoader) {
            this.dom.pageLoader.classList.add("loader-fade-out");
            setTimeout(() => {
                this.dom.pageLoader.style.display = "none";
            }, 300); // Tăng tốc độ ẩn màn hình loading
        }
    },

    showCongratulation(courseId) {
        const course = this.state.courses.find((c) => c.id === courseId);
        const courseTitle = course ? course.title : "Khóa học";

        const modal = document.getElementById("congrats-modal");
        const content = document.getElementById("congrats-modal-content");
        document.getElementById("congrats-course-title").innerText = courseTitle;

        if (modal && content) {
            modal.classList.remove("hidden");
            setTimeout(() => {
                modal.classList.remove("opacity-0");
                content.classList.remove("scale-95");
                content.classList.add("scale-100");
            }, 10);

            modal.dataset.courseId = courseId;
            this.playSound("sounds/ping.mp3");
        }
    },

    closeCongratsModal() {
        const modal = document.getElementById("congrats-modal");
        const content = document.getElementById("congrats-modal-content");
        if (modal && content) {
            modal.classList.add("hidden");

            const courseId = modal.dataset.courseId;
            if (courseId) {
                this.showLearningView(courseId);
            }
        }
    },

    showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'fixed top-20 right-5 z-[9999] flex flex-col gap-3 pointer-events-none';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        let icon = '<i class="fa-solid fa-circle-info text-blue-500"></i>';
        let bgColor = 'border-blue-500';

        if (type === 'success') {
            icon = '<i class="fa-solid fa-circle-check text-green-500"></i>';
            bgColor = 'border-green-500';
        } else if (type === 'error') {
            icon = '<i class="fa-solid fa-circle-exclamation text-red-500"></i>';
            bgColor = 'border-red-500';
        } else if (type === 'warning') {
            icon = '<i class="fa-solid fa-triangle-exclamation text-yellow-500"></i>';
            bgColor = 'border-yellow-500';
        }

        toast.className = `bg-white dark:bg-slate-800 border-l-4 ${bgColor} shadow-lg rounded-xl p-4 flex items-center gap-3 transform transition-transform duration-300 translate-x-[120%] pointer-events-auto min-w-[250px] max-w-sm`;
        toast.innerHTML = `
            <div class="text-xl">${icon}</div>
            <div class="text-sm font-bold text-gray-800 dark:text-gray-200 whitespace-pre-line">${message}</div>
        `;
        container.appendChild(toast);

        setTimeout(() => toast.classList.remove('translate-x-[120%]'), 10);
        setTimeout(() => {
            toast.classList.add('translate-x-[120%]');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
};

function showConfirmModal(message, onConfirm) {
    const existing = document.getElementById('custom-confirm-modal');
    if (existing) existing.remove();

    const modalHTML = `
        <div id="custom-confirm-modal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center animate-fade">
            <div class="bg-white dark:bg-slate-900 w-full max-w-sm mx-4 rounded-3xl p-6 border border-gray-100 dark:border-slate-800 shadow-2xl text-center transform transition-transform scale-95 duration-300" id="custom-confirm-content">
                <div class="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white dark:border-slate-900 shadow-sm text-3xl">
                    <i class="fa-solid fa-circle-question"></i>
                </div>
                <h3 class="text-xl font-black text-gray-900 dark:text-white mb-2">Xác nhận</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-6 font-medium">${message}</p>
                <div class="flex gap-3">
                    <button id="btn-confirm-cancel" class="flex-1 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">Hủy</button>
                    <button id="btn-confirm-ok" class="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#0056D2] hover:bg-blue-700 transition-colors shadow-md">Đồng ý</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('custom-confirm-modal');
    const content = document.getElementById('custom-confirm-content');
    
    setTimeout(() => content.classList.replace('scale-95', 'scale-100'), 10);

    const close = () => {
        modal.classList.add('opacity-0');
        content.classList.replace('scale-100', 'scale-95');
        setTimeout(() => modal.remove(), 300);
    };

    document.getElementById('btn-confirm-cancel').onclick = close;
    document.getElementById('btn-confirm-ok').onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };
}

function logoutUser() {
    showConfirmModal("Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?", () => {
        localStorage.removeItem("coursera_user_session");
        window.location.href = "login.html";
    });
}

function closeReviewModal() {
    const modal = document.getElementById("review-modal");
    if (modal) {
        modal.classList.add("opacity-0");
        setTimeout(() => modal.classList.add("hidden"), 300);
    }
}

async function openAccountModal(targetSubTab = "profile") {
    const modal = App.dom.accountModal;
    if (!modal || !App.state.user) return;

    // 1. Điền thông tin người dùng vào tab Hồ sơ
    document.getElementById("md-user-name").innerText = App.state.user.fullname;
    document.getElementById("md-user-email").innerText = App.state.user.email;
    document.getElementById("md-user-date").innerText = App.state.user.created_at;

    // 2. Render danh sách khóa học của bạn
    const myCoursesContainer = document.getElementById("md-my-courses-container");
    myCoursesContainer.innerHTML = "";
    const myCourses = App.state.courses.filter(
        (c) => c.lock_status === "UNLOCKED",
    );

    if (myCourses.length > 0) {
        myCourses.forEach((course) => {
            myCoursesContainer.innerHTML += `
                <div class="flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                    <div class="h-32 bg-gray-200 dark:bg-slate-700 bg-cover bg-center border-b border-gray-100 dark:border-slate-800 relative" style="background-image: url('${App.getCourseImage(course)}');">
                        <div class="absolute inset-0 bg-black/20"></div>
                    </div>
                    <div class="p-5 flex flex-col flex-1">
                        <p class="font-bold text-gray-900 dark:text-white leading-snug mb-4 flex-1 text-base line-clamp-2">${course.title}</p>
                        <button onclick="closeAccountModal(); App.showLearningView('${course.id}')" class="w-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-[#0056D2] dark:text-blue-400 font-bold py-2.5 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-1.5 mt-auto">
                            <i class="fa-solid fa-play"></i> Vào học ngay
                        </button>
                    </div>
                </div>
            `;
        });
    } else {
        myCoursesContainer.innerHTML = `<p class="text-center text-gray-500 col-span-full py-4 font-medium">Bạn chưa sở hữu khóa học nào.</p>`;
    }

    // 3. Render danh sách lịch sử đơn hàng
    const ordersContainer = document.getElementById("md-orders-container");
    ordersContainer.innerHTML = ""; // Xóa nội dung cũ
    if (App.state.orders && App.state.orders.length > 0) {
        App.state.orders.forEach((order) => {
            let statusHTML = "";
            switch (parseInt(order.current_step)) {
                case 1:
                    statusHTML = `<span class="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400">Chờ xác nhận</span>`;
                    break;
                case 3:
                    statusHTML = `<span class="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">Đã duyệt</span>`;
                    break;
                case 4:
                    statusHTML = `<span class="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">Bị từ chối</span>`;
                    break;
                default:
                    statusHTML = `<span class="bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-300">Không xác định</span>`;
            }

            const courseInfo = App.state.courses.find(
                (c) => c.id === order.course_name,
            ) || { title: order.course_name };

            ordersContainer.innerHTML += `
                <div class="flex flex-col p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1">
                            <p class="font-bold text-gray-800 dark:text-gray-200 leading-tight">${courseInfo.title}</p>
                            <p class="text-xs text-gray-500 mt-1">Ngày: ${order.created_at} | Giá: ${Number(order.price).toLocaleString("vi-VN")} đ</p>
                        </div>
                        <div class="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0">${statusHTML}</div>
                    </div>
                </div>
            `;
        });
    } else {
        ordersContainer.innerHTML = `<p class="text-center text-gray-500">Bạn chưa ghi danh khóa học nào.</p>`;
    }

    // 3. Chuyển đến tab được yêu cầu và hiển thị modal
    switchSubTab(targetSubTab);
    modal.classList.remove("hidden");
}

function closeAccountModal() {
    const modal = document.getElementById("account-modal");
    if (modal) {
        modal.classList.add("hidden");
    }
}

function switchSubTab(tabId) {
    // Ẩn tất cả nội dung
    document
        .querySelectorAll('[id^="subtab-content-"]')
        .forEach((el) => el.classList.add("hidden"));
    document.getElementById("md-password-form").classList.add("hidden");

    // Reset style tất cả các nút
    document.querySelectorAll('[id^="subtab-btn-"]').forEach((btn) => {
        btn.classList.remove(
            "bg-blue-50",
            "dark:bg-blue-950/40",
            "text-[#0056D2]",
            "dark:text-blue-400",
        );
        btn.classList.add("hover:bg-gray-100", "dark:hover:bg-slate-800");
    });

    // Kích hoạt nút và nội dung tương ứng
    const targetBtn = document.getElementById(`subtab-btn-${tabId}`);
    targetBtn.classList.add(
        "bg-blue-50",
        "dark:bg-blue-950/40",
        "text-[#0056D2]",
        "dark:text-blue-400",
    );
    targetBtn.classList.remove("hover:bg-gray-100", "dark:hover:bg-slate-800");

    if (tabId === "security") {
        document.getElementById("md-password-form").classList.remove("hidden");
    } else {
        const targetContent = document.getElementById(`subtab-content-${tabId}`);
        if (targetContent) targetContent.classList.remove("hidden");
    }
}

async function handleModalChangePassword(event) {
    event.preventDefault();
    const oldPwd = document.getElementById("md-old-pwd").value;
    const newPwd = document.getElementById("md-new-pwd").value;
    const confirmPwd = document.getElementById("md-confirm-pwd").value;
    const btn = document.getElementById("md-pwd-btn");
    const msg = document.getElementById("md-pwd-msg");

    msg.classList.add("hidden");

    if (newPwd !== confirmPwd) {
        msg.innerText = "Mật khẩu mới không khớp!";
        msg.className =
            "text-xs font-bold mt-2 text-red-500 dark:text-red-400 block";
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang cập nhật...`;

    try {
        const res = await fetch("change_password.php", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${App.state.token}`,
            },
            body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
        });
        const data = await res.json();

        if (res.ok) {
            msg.innerText = data.message || "Đổi mật khẩu thành công!";
            msg.className =
                "text-xs font-bold mt-2 text-green-600 dark:text-green-400 block";
            document.getElementById("md-password-form").reset();
        } else {
            msg.innerText = data.message || "Có lỗi xảy ra.";
            msg.className =
                "text-xs font-bold mt-2 text-red-500 dark:text-red-400 block";
        }
    } catch (e) {
        msg.innerText = "Lỗi kết nối tới máy chủ.";
        msg.className =
            "text-xs font-bold mt-2 text-red-500 dark:text-red-400 block";
    } finally {
        btn.disabled = false;
        btn.innerText = "Cập nhật";
    }
}

function closePaymentModal() {
    const modal = document.getElementById("payment-modal");
    if (modal) modal.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => App.init());
