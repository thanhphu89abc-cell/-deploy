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
            searchInput: document.getElementById("course-search-input"),
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
            alert(
                "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
            );
            window.location.href = "login.html";
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
                            oldOrder.current_step === 1 &&
                            newOrder.current_step === 3
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
                    <div class="h-[160px] bg-gray-200 dark:bg-slate-800"></div>
                    <div class="p-5 flex-1 flex flex-col justify-between">
                        <div>
                            <div class="h-2 bg-gray-200 dark:bg-slate-800 rounded w-3/4 mb-4"></div>
                            <div class="h-1.5 bg-gray-200 dark:bg-slate-800 rounded w-full mb-5"></div>
                            <div class="h-6 bg-gray-200 dark:bg-slate-800 rounded w-1/2 ml-auto"></div>
                        </div>
                        <div class="mt-4 h-9 bg-gray-200 dark:bg-slate-800 rounded-xl"></div>
                    </div>
                </div>
            `;
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

    renderDashboardCourses() {
        if (!this.dom.coursesGrid) return;

        let filteredCourses = this.state.courses;
        if (this.state.searchQuery) {
            filteredCourses = filteredCourses.filter((c) =>
                c.title.toLowerCase().includes(this.state.searchQuery),
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
                "course-card bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-gray-200 dark:border-slate-800 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col";

            const isMyCourses = this.state.currentTab === "my_courses";

            let actionButtonHTML = isMyCourses
                ? `<button onclick="App.showLearningView('${course.id}')" class="w-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-[#0056D2] dark:text-blue-400 font-bold py-2.5 rounded-lg text-sm transition-colors"><i class="fa-solid fa-play mr-1.5"></i> Vào học</button>`
                : `<button onclick="App.showLearningView('${course.id}', true)" class="w-full bg-[#0056D2] hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors shadow-sm"><i class="fa-solid fa-graduation-cap mr-1.5"></i> Ghi danh lộ trình</button>`;

            let clickAction = isMyCourses
                ? `App.showLearningView('${course.id}')`
                : `App.showLearningView('${course.id}', true)`;

            const bgStyle = course.icon
                ? `background-image: url('${course.icon}'); background-size: cover; background-position: center;`
                : ``;
            const bgClass = course.icon
                ? ""
                : `bg-gradient-to-br ${course.color || "from-gray-700 to-slate-900"}`;

            card.innerHTML = `
                <div onclick="${clickAction}" class="${bgClass} relative cursor-pointer w-full shrink-0 group overflow-hidden border-b border-gray-100 dark:border-slate-800" style="height: 160px; ${bgStyle}">
                    <div class="absolute inset-0 bg-black/10 group-hover:bg-black/40 transition-colors duration-300 z-0"></div>
                    <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-[2px] z-10">
                        <span class="bg-white/25 text-white font-bold px-5 py-2 rounded-full border border-white/40 shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 text-sm flex items-center gap-2">
                            <i class="fa-solid ${isMyCourses ? "fa-play" : "fa-eye"}"></i> ${isMyCourses ? "Vào bài giảng" : "Xem khóa học"}
                        </span>
                    </div>
                    <div class="absolute top-3 left-3 z-20">
                        <span class="text-[10px] font-black uppercase tracking-wider bg-white text-[#0056D2] px-3 py-1 rounded-md shadow-sm border border-black/5">${course.badge || "Chuyên đề"}</span>
                    </div>
                </div>
                <div class="p-5 flex-1 flex flex-col bg-white dark:bg-slate-900">
                    <div class="flex-1 cursor-pointer group flex flex-col" onclick="${clickAction}">
                        <div class="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Coursera Project</div>
                        <h3 class="text-gray-900 dark:text-white font-bold text-lg leading-snug group-hover:text-[#0056D2] dark:group-hover:text-blue-400 transition-colors line-clamp-2" title="${course.title}">${course.title}</h3>
                        
                        <div class="mt-auto pt-4">
                            <div class="flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                                <span>Tiến độ học tập</span>
                                <span class="text-[#0056D2] dark:text-blue-400">${progress}%</span>
                            </div>
                            <div class="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div class="bg-[#0056D2] dark:bg-blue-500 h-full transition-all duration-500" style="width: ${progress}%"></div>
                            </div>
                            
                            <div class="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-gray-600 dark:text-gray-400">
                                <span class="bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-gray-100 dark:border-slate-700 flex items-center gap-1.5"><i class="fa-solid fa-layer-group text-gray-400"></i> ${course.weeks.length} Module</span>
                                <span class="bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-gray-100 dark:border-slate-700 flex items-center gap-1.5"><i class="fa-solid fa-certificate text-gray-400"></i> Chứng chỉ</span>
                            </div>
                        </div>
                    </div>
                    <div class="mt-5 shrink-0">
                        ${actionButtonHTML}
                    </div>
                </div>
            `;
            this.dom.coursesGrid.appendChild(card);
        });
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
            alert("Lỗi: Không tìm thấy dữ liệu khóa học.");
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
                overlayBtnHTML = `<button onclick="App.openPaymentModal('${course.id}')" class="bg-[#0056D2] hover:bg-blue-700 text-white font-bold py-3 px-8 rounded transition-colors shadow-sm flex items-center gap-2 mx-auto mt-6">
                    Ghi danh lộ trình
                   </button>`;
                overlayTitle = "Tham gia khóa học để mở khóa nội dung";
                overlayDesc =
                    "Ghi danh lộ trình này để truy cập toàn bộ bài giảng video, thực hành trên nền tảng Lab trực tuyến và nhận Chứng chỉ hoàn thành từ Coursera Advanced.";
            }

            const bgStyle = course.icon
                ? `background-image: url('${course.icon}'); background-size: cover; background-position: center;`
                : ``;
            const bgOverlay = course.icon
                ? `bg-white/95 dark:bg-[#0B0F19]/95 backdrop-blur-sm`
                : `bg-white dark:bg-[#0B0F19]`;

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
            this.dom.courseNavigation.appendChild(weekEl);
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
            this.dom.courseNavigation.appendChild(certButton);
        }
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
            alert("Lỗi: Không tìm thấy bài học.");
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
            this.dom.videoWrapper.innerHTML = `<iframe src="https://www.youtube.com/embed/${lesson.videoSrc}?autoplay=1&rel=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>`;
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
                await fetch("http://127.0.0.1:5000/api/user/progress", {
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

    handleSearch() {
        if (this.dom.searchInput) {
            this.state.searchQuery = this.dom.searchInput.value.toLowerCase().trim();
            this.state.currentPage = 1;
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
            alert("Vui lòng chọn một đáp án!");
            return;
        }

        const course = this.state.courses.find(
            (c) => c.id === this.state.currentItemRef.courseId,
        );
        const lesson = course?.weeks
            .flatMap((w) => w.items)
            .find((i) => i.id === this.state.currentItemRef.lessonId);

        if (!lesson || !lesson.quiz) {
            alert("Lỗi: Không tìm thấy dữ liệu quiz.");
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
            const res = await fetch("http://127.0.0.1:5000/api/chatbot", {
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
            const res = await fetch("http://127.0.0.1:5000/api/lessons/submit-flag", {
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

    async openPaymentModal(courseId) {
        const payCourseTitleEl = document.getElementById("pay-course-title");
        const payPriceEl = document.getElementById("pay-price");
        const btnConfirm = document.getElementById("btn-confirm-mock-pay");

        document.getElementById("pay-qr-img").src = "";
        document.getElementById("pay-memo").innerText = "Đang tạo mã...";

        // Reset discount UI
        const discountInput = document.getElementById("discount-code-input");
        const discountMsg = document.getElementById("discount-message");
        if (discountInput) discountInput.value = "";
        if (discountMsg) discountMsg.classList.add("hidden");

        this.dom.paymentModal.classList.remove("hidden");

        const course = this.state.courses.find((c) => c.id === courseId);
        if (!course) {
            alert("Lỗi: Không tìm thấy khóa học để thanh toán.");
            closePaymentModal();
            return;
        }
        const url = "checkout.php";
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
            } else {
                alert(data.message || "Lỗi tạo thanh toán");
                closePaymentModal();
            }
        } catch (e) {
            alert("Lỗi kết nối khi tạo mã thanh toán.");
            closePaymentModal();
        }
    },

    async applyDiscount() {
        const inputEl = document.getElementById("discount-code-input");
        const msgEl = document.getElementById("discount-message");
        const btnConfirm = document.getElementById("btn-confirm-mock-pay");
        const orderId = btnConfirm.dataset.orderId;

        const code = inputEl.value.trim();
        if (!code) return;

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

                document.getElementById("pay-price").innerHTML =
                    `<span class="line-through text-gray-400 dark:text-gray-500 font-medium text-sm mr-2">${Number(data.original_price).toLocaleString("vi-VN")} đ</span><span class="text-green-600 dark:text-green-400">${Number(data.new_price).toLocaleString("vi-VN")} đ</span>`;
                document.getElementById("pay-qr-img").src = data.qr_url;
            } else {
                msgEl.innerText = data.message;
                msgEl.classList.remove("text-gray-500");
                msgEl.classList.add("text-red-500", "dark:text-red-400");
            }
        } catch (e) {
            msgEl.innerText = "Lỗi kết nối máy chủ.";
            msgEl.classList.remove("text-gray-500");
            msgEl.classList.add("text-red-500", "dark:text-red-400");
        }
    },

    async confirmMockPayment() {
        const btn = document.getElementById("btn-confirm-mock-pay");
        const orderId = btn.dataset.orderId;
        const courseId = btn.dataset.courseId;

        if (!courseId || courseId === "undefined") {
            alert("Lỗi: Không tìm thấy mã khóa học để xác nhận.");
            return;
        }

        const url = "mock_webhook.php";
        const body = { course_id: courseId };

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
            alert(data.message);
            if (res.ok) {
                closePaymentModal();
                btn.dataset.orderId = ""; // Reset dataset
                await this.loadData();
                this.renderDashboardCourses();
                // Cập nhật lại giao diện người dùng để hiện đơn hàng chờ duyệt
                this.checkAuth().then(() => this.updateUserInfoDisplay());
            }
        } catch (e) {
            alert("Lỗi xác nhận thanh toán.");
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
            alert("Vui lòng chọn số sao đánh giá!");
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
            const res = await fetch("http://127.0.0.1:5000/api/courses/review", {
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
                alert(data.message || "Cảm ơn bạn đã đánh giá khóa học!");
                closeReviewModal();
            } else {
                alert(data.message || "Có lỗi xảy ra.");
            }
        } catch (err) {
            alert("Lỗi kết nối tới máy chủ.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },

    async downloadCertificate(courseId) {
        const course = this.state.courses.find((c) => c.id === courseId);
        if (!course) {
            alert("Không tìm thấy khóa học!");
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
            alert(
                `Bạn cần hoàn thành 100% khóa học để nhận chứng chỉ. Tiến độ hiện tại: ${progress}%`,
            );
            return;
        }

        try {
            const response = await fetch(
                `http://127.0.0.1:5000/api/user/certificate/${courseId}`,
                {
                    headers: { Authorization: `Bearer ${this.state.token}` },
                },
            );
            const data = await response.json();
            if (response.ok)
                alert(
                    `🎓 CHÚC MỪNG!\n\nHọc viên: ${data.fullname}\nĐã hoàn thành xuất sắc: ${data.course_title}\n\nMã chứng chỉ: ${data.cert_id}\nNgày cấp: ${data.date}\n\n(Tính năng tạo file PDF đang được phát triển.)`,
                );
            else alert(data.message || "Không thể tải chứng chỉ.");
        } catch (err) {
            alert("Lỗi kết nối máy chủ khi xuất chứng chỉ.");
        }
    },

    downloadPdf() {
        alert("Tính năng đang được phát triển. Tài liệu sẽ sớm được cập nhật!");
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
            }, 500); // Phải khớp với duration trong CSS
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
            modal.classList.add("opacity-0");
            content.classList.remove("scale-100");
            content.classList.add("scale-95");
            setTimeout(() => modal.classList.add("hidden"), 500);

            const courseId = modal.dataset.courseId;
            if (courseId) {
                this.showLearningView(courseId);
            }
        }
    },
};

function logoutUser() {
    if (confirm("Bạn có chắc chắn muốn đăng xuất?")) {
        localStorage.removeItem("coursera_user_session");
        window.location.href = "login.html";
    }
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
                    <div class="h-32 bg-gray-200 dark:bg-slate-700 bg-cover bg-center border-b border-gray-100 dark:border-slate-800 relative" style="background-image: url('${course.icon || ""}');">
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
            switch (order.current_step) {
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
    modal.classList.remove("hidden", "opacity-0");
}

function closeAccountModal() {
    const modal = document.getElementById("account-modal");
    if (modal) modal.classList.add("hidden", "opacity-0");
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
