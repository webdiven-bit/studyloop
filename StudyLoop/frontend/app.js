class StudyLoop {
    constructor() {
        // Auto-detect environment
        this.isLocal = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.port === '3000' ||
                      window.location.port === '8080';
        
        // Set API endpoint - UPDATE THIS WITH YOUR HUGGING FACE URL
        this.apiEndpoint = this.isLocal 
            ? "http://localhost:8000"  // Local development
            : "https://andevs-studyloop.hf.space";  // Your Hugging Face Space URL
        
        console.log(`API Endpoint: ${this.apiEndpoint}`);
        console.log(`Environment: ${this.isLocal ? 'Local' : 'Production'}`);
        
        this.currentSession = null;
        this.questions = [];
        this.userAnswers = new Map();
        this.concepts = [];
        this.isGenerating = false;
        
        this.initializeEventListeners();
        this.checkForCachedSession();
        this.loadAd();
    }

    initializeEventListeners() {
        // File upload
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const browseBtn = document.getElementById('browseBtn');

        dropZone.addEventListener('click', () => fileInput.click());
        browseBtn.addEventListener('click', () => fileInput.click());
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#7209b7';
            dropZone.style.background = 'rgba(114, 9, 183, 0.05)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#4361ee';
            dropZone.style.background = 'transparent';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#4361ee';
            dropZone.style.background = 'transparent';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Question controls
        document.getElementById('toggleAllAnswers').addEventListener('click', () => {
            this.toggleAllAnswers();
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportSession();
        });

        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.startNewSession();
        });

        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            this.generateMoreQuestions();
        });

        document.getElementById('reviewBtn').addEventListener('click', () => {
            this.reviewIncorrectAnswers();
        });

        document.getElementById('shareBtn').addEventListener('click', () => {
            this.shareResults();
        });

        // Initialize tooltips
        this.initializeTooltips();
    }

    initializeTooltips() {
        // Add tooltips to buttons
        const tooltips = {
            'toggleAllAnswers': 'Show/hide all answers at once',
            'exportBtn': 'Export session as JSON file',
            'newSessionBtn': 'Start a new study session',
            'loadMoreBtn': 'Generate 5 more questions',
            'reviewBtn': 'Review questions you got wrong',
            'shareBtn': 'Share your results'
        };

        Object.keys(tooltips).forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.title = tooltips[id];
            }
        });
    }

    async handleFileUpload(file) {
        if (this.isGenerating) {
            this.showError('Please wait for current generation to complete');
            return;
        }

        // Validate file
        if (!this.validateFile(file)) return;

        // Show progress
        this.showUploadProgress();

        try {
            // Parse file
            const content = await this.parseFile(file);
            
            // Generate session
            this.currentSession = await this.generateQuestions(content);
            
            // Store in localStorage
            this.saveSessionToCache();
            
            // Display questions
            this.displayQuestions();
            
            // Switch views
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('questionsSection').style.display = 'block';
            
            // Scroll to questions
            document.querySelector('.questions-container').scrollIntoView({ behavior: 'smooth' });
            
        } catch (error) {
            console.error('Upload failed:', error);
            this.showError(`Failed to process file: ${error.message}. Please try again with a different file.`);
        } finally {
            this.hideUploadProgress();
        }
    }

    validateFile(file) {
        const validTypes = ['application/pdf', 'text/plain'];
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        // Check file type
        const isValidType = validTypes.includes(file.type) || 
                           file.name.toLowerCase().endsWith('.pdf') || 
                           file.name.toLowerCase().endsWith('.txt');
        
        if (!isValidType) {
            this.showError('Please upload PDF or text files only. Supported formats: .pdf, .txt');
            return false;
        }
        
        // Check file size
        if (file.size > maxSize) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(2);
            this.showError(`File size must be less than 5MB. Current: ${sizeMB}MB`);
            return false;
        }
        
        // Check if file is empty
        if (file.size === 0) {
            this.showError('File is empty. Please upload a valid file.');
            return false;
        }
        
        return true;
    }

    async parseFile(file) {
        this.updateProgress(30, 'Parsing file...');
        
        return new Promise((resolve, reject) => {
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                this.parsePDF(file).then(resolve).catch(reject);
            } else {
                this.parseTextFile(file).then(resolve).catch(reject);
            }
        });
    }

    async parsePDF(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    this.updateProgress(50, 'Extracting text from PDF...');
                    
                    // Load PDF.js if not already loaded
                    if (typeof pdfjsLib === 'undefined') {
                        this.showError('PDF library not loaded. Please refresh the page.');
                        reject(new Error('PDF library not available'));
                        return;
                    }
                    
                    const pdfData = new Uint8Array(e.target.result);
                    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
                    
                    let text = '';
                    const maxPages = Math.min(pdf.numPages, 20); // Limit to 20 pages
                    
                    for (let i = 1; i <= maxPages; i++) {
                        this.updateProgress(50 + (i / maxPages * 20), `Reading page ${i}/${maxPages}...`);
                        
                        const page = await pdf.getPage(i);
                        const content = await page.getTextContent();
                        text += content.items.map(item => item.str).join(' ') + '\n';
                    }
                    
                    if (text.trim().length === 0) {
                        reject(new Error('No readable text found in PDF. The PDF might be scanned or image-based.'));
                        return;
                    }
                    
                    resolve(text);
                } catch (err) {
                    console.error('PDF parsing error:', err);
                    reject(new Error(`Failed to parse PDF: ${err.message}`));
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    async parseTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                if (text.trim().length < 50) {
                    reject(new Error('Text too short. Please upload a document with at least 50 characters.'));
                    return;
                }
                resolve(text);
            };
            reader.onerror = (e) => {
                reject(new Error(`Failed to read file: ${e.target.error}`));
            };
            reader.readAsText(file, 'UTF-8');
        });
    }

    async generateQuestions(content) {
        this.updateProgress(60, 'Generating questions...');
        this.isGenerating = true;
        
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            // Show API status
            this.showStatus('Connecting to AI service...');
            
            const response = await fetch(`${this.apiEndpoint}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: content,
                    session_id: sessionId,
                    options: JSON.stringify({
                        num_questions: 10,
                        question_types: ['multiple_choice', 'short_answer'],
                        difficulty: 'mixed'
                    })
                }),
                timeout: 60000 // 60 second timeout
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error:', response.status, errorText);
                
                if (response.status === 429) {
                    throw new Error('Too many requests. Please wait a moment and try again.');
                } else if (response.status === 500) {
                    throw new Error('Server error. Our AI service might be busy. Please try again.');
                } else {
                    throw new Error(`API Error (${response.status}): ${errorText.substring(0, 100)}`);
                }
            }
            
            const data = await response.json();
            this.updateProgress(90, 'Finalizing...');
            
            // Process and store data
            this.questions = data.questions || [];
            this.concepts = data.concepts || [];
            
            // If no questions were generated, use fallback
            if (this.questions.length === 0) {
                throw new Error('No questions were generated. The content might be too short or complex.');
            }
            
            this.showSuccess(`Generated ${this.questions.length} questions!`);
            
            return {
                id: sessionId,
                generated_at: new Date().toISOString(),
                file_hash: await this.calculateFileHash(content),
                ...data
            };
            
        } catch (error) {
            console.error('API call failed:', error);
            
            // Fallback to mock questions for demo
            if (this.isLocal || error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                this.showStatus('Using demo mode (offline)...');
                return this.generateMockQuestions(content, sessionId);
            } else {
                throw error; // Re-throw to show error to user
            }
        } finally {
            this.isGenerating = false;
            this.hideStatus();
        }
    }

    generateMockQuestions(content, sessionId) {
        // Create mock questions based on content
        const words = content.split(/\s+/).filter(w => w.length > 3);
        const uniqueWords = [...new Set(words)].slice(0, 5);
        
        const mockQuestions = [
            {
                id: `${sessionId}_1`,
                type: 'multiple_choice',
                question: `What is the main topic discussed in the text?`,
                options: [
                    'General overview of the subject',
                    'Detailed technical analysis',
                    'Historical context',
                    'Future implications'
                ],
                correct_answer: 'General overview of the subject',
                explanation: 'The text provides a general introduction to the topic.',
                difficulty: 'easy',
                concept: 'Main Topic'
            },
            {
                id: `${sessionId}_2`,
                type: 'short_answer',
                question: 'Summarize the key point of the text in one sentence.',
                correct_answer: 'The text discusses important concepts that form the foundation of the subject.',
                explanation: 'This summary captures the essential information presented.',
                difficulty: 'medium',
                concept: 'Summary'
            },
            {
                id: `${sessionId}_3`,
                type: 'multiple_choice',
                question: 'Which of the following is NOT mentioned in the text?',
                options: [
                    'Basic principles',
                    'Practical applications',
                    'Mathematical formulas',
                    'Key terminology'
                ],
                correct_answer: 'Mathematical formulas',
                explanation: 'The text focuses on concepts rather than mathematical details.',
                difficulty: 'medium',
                concept: 'Content Coverage'
            }
        ];
        
        // Add more mock questions if content has enough words
        if (uniqueWords.length >= 3) {
            mockQuestions.push({
                id: `${sessionId}_4`,
                type: 'multiple_choice',
                question: `What does the term "${uniqueWords[0]}" refer to in this context?`,
                options: [
                    'A fundamental concept',
                    'A technical specification',
                    'An example application',
                    'A common misconception'
                ],
                correct_answer: 'A fundamental concept',
                explanation: `"${uniqueWords[0]}" is presented as a key concept in the text.`,
                difficulty: 'hard',
                concept: 'Terminology'
            });
        }
        
        const mockConcepts = ['Main Topic', 'Summary', 'Content Coverage', 'Terminology'];
        
        return {
            id: sessionId,
            questions: mockQuestions,
            concepts: mockConcepts,
            generated_at: new Date().toISOString(),
            is_mock: true
        };
    }

    displayQuestions() {
        const questionsContainer = document.getElementById('questionsContainer');
        const conceptsList = document.getElementById('conceptsList');
        
        // Clear previous content
        questionsContainer.innerHTML = '';
        conceptsList.innerHTML = '';
        
        // Display concepts
        if (this.concepts && this.concepts.length > 0) {
            this.concepts.forEach(concept => {
                const tag = document.createElement('span');
                tag.className = 'concept-tag';
                tag.textContent = concept;
                tag.title = `Click to filter questions about "${concept}"`;
                tag.onclick = () => this.filterByConcept(concept);
                conceptsList.appendChild(tag);
            });
        }
        
        // Display questions
        this.questions.forEach((question, index) => {
            const questionElement = this.createQuestionElement(question, index);
            questionsContainer.appendChild(questionElement);
        });
        
        // Update progress
        this.updateProgressIndicator();
        
        // Show results summary if we have answers
        if (this.userAnswers.size > 0) {
            this.updateResultsSummary();
            document.getElementById('resultsCard').style.display = 'block';
        }
        
        // Show session info
        this.showSessionInfo();
    }

    createQuestionElement(question, index) {
        const card = document.createElement('div');
        card.className = 'question-card';
        card.dataset.id = question.id;
        card.dataset.type = question.type;
        card.dataset.concept = question.concept || 'General';
        
        let optionsHtml = '';
        let actionsHtml = '';
        
        if (question.type === 'multiple_choice') {
            optionsHtml = this.createMultipleChoiceOptions(question);
            actionsHtml = `
                <div class="question-actions">
                    <button class="btn btn-secondary check-btn" onclick="app.checkAnswer('${question.id}')" 
                            title="Check if your answer is correct">
                        <i class="fas fa-check"></i> Check Answer
                    </button>
                    <button class="btn btn-outline show-btn" onclick="app.toggleAnswer('${question.id}')" 
                            title="Show/hide the correct answer">
                        <i class="fas fa-eye"></i> Show Answer
                    </button>
                </div>
            `;
        } else {
            optionsHtml = `
                <textarea class="short-answer-input" 
                    id="answer_${question.id}"
                    placeholder="Type your answer here... (1-3 sentences recommended)"
                    oninput="app.updateShortAnswer('${question.id}', this.value)"
                    rows="3"></textarea>
            `;
            actionsHtml = `
                <div class="question-actions">
                    <button class="btn btn-secondary submit-btn" onclick="app.submitShortAnswer('${question.id}')"
                            title="Submit your answer for evaluation">
                        <i class="fas fa-paper-plane"></i> Submit Answer
                    </button>
                    <button class="btn btn-outline show-btn" onclick="app.toggleAnswer('${question.id}')"
                            title="Show/hide the correct answer">
                        <i class="fas fa-eye"></i> Show Answer
                    </button>
                </div>
            `;
        }
        
        const userAnswer = this.userAnswers.get(question.id);
        const isAnswered = userAnswer && userAnswer.answered;
        const isCorrect = isAnswered ? userAnswer.correct : false;
        
        let statusIcon = '';
        if (isAnswered) {
            statusIcon = isCorrect ? 
                '<i class="fas fa-check-circle correct-icon" title="Correct answer"></i>' : 
                '<i class="fas fa-times-circle incorrect-icon" title="Incorrect answer"></i>';
        }
        
        const difficultyBadge = question.difficulty ? 
            `<span class="difficulty-badge ${question.difficulty}" title="${question.difficulty} difficulty">${question.difficulty}</span>` : '';
        
        card.innerHTML = `
            <div class="question-header">
                <div class="question-number">
                    ${statusIcon}
                    <span>Question ${index + 1}</span>
                    ${difficultyBadge}
                </div>
                <div class="question-type">
                    ${question.type.replace('_', ' ').toUpperCase()}
                </div>
            </div>
            
            <div class="question-text">
                ${question.question}
            </div>
            
            <div class="options-container">
                ${optionsHtml}
            </div>
            
            <div class="answer-section" id="answer_section_${question.id}">
                <div class="correct-answer">
                    <strong>Correct Answer:</strong> <span class="answer-text">${question.correct_answer}</span>
                </div>
                <div class="answer-explanation">
                    <strong>Explanation:</strong> ${question.explanation || 'Explanation based on the source material.'}
                </div>
            </div>
            
            ${actionsHtml}
        `;
        
        // If already answered, show the result
        if (isAnswered) {
            this.showAnswerResult(card, question.id, userAnswer);
        }
        
        return card;
    }

    createMultipleChoiceOptions(question) {
        return question.options.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const userAnswer = this.userAnswers.get(question.id);
            let optionClass = 'option';
            
            if (userAnswer && userAnswer.answered) {
                if (userAnswer.selected === index) {
                    optionClass += userAnswer.correct ? ' correct selected' : ' incorrect selected';
                } else if (option === question.correct_answer) {
                    optionClass += ' correct';
                }
            }
            
            return `
                <div class="${optionClass}" data-index="${index}" onclick="app.selectOption('${question.id}', ${index})">
                    <div class="option-letter">${letter}</div>
                    <div class="option-text">${option}</div>
                    ${userAnswer && userAnswer.answered && option === question.correct_answer ? 
                        '<i class="fas fa-check correct-check" title="Correct answer"></i>' : ''}
                </div>
            `;
        }).join('');
    }

    selectOption(questionId, optionIndex) {
        const question = this.questions.find(q => q.id === questionId);
        if (!question) return;
        
        const card = document.querySelector(`.question-card[data-id="${questionId}"]`);
        if (!card) return;
        
        const options = card.querySelectorAll('.option');
        
        // Reset all options
        options.forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Select clicked option
        options[optionIndex].classList.add('selected');
        
        // Store selection
        if (!this.userAnswers.has(questionId)) {
            this.userAnswers.set(questionId, {
                selected: optionIndex,
                answered: false,
                correct: false,
                timestamp: Date.now()
            });
        } else {
            const answer = this.userAnswers.get(questionId);
            answer.selected = optionIndex;
            answer.timestamp = Date.now();
        }
        
        this.saveSessionToCache();
    }

    checkAnswer(questionId) {
        const question = this.questions.find(q => q.id === questionId);
        const userAnswer = this.userAnswers.get(questionId);
        
        if (!question) {
            this.showError('Question not found');
            return;
        }
        
        if (!userAnswer || userAnswer.selected === undefined) {
            this.showError('Please select an answer first');
            return;
        }
        
        if (userAnswer.answered) {
            this.showError('Answer already checked');
            return;
        }
        
        const isCorrect = question.options[userAnswer.selected] === question.correct_answer;
        userAnswer.answered = true;
        userAnswer.correct = isCorrect;
        userAnswer.checkedAt = new Date().toISOString();
        
        // Update UI
        const card = document.querySelector(`.question-card[data-id="${questionId}"]`);
        if (card) {
            this.showAnswerResult(card, questionId, userAnswer);
        }
        
        // Update progress
        this.updateProgressIndicator();
        this.updateResultsSummary();
        
        // Show results card if not shown
        const resultsCard = document.getElementById('resultsCard');
        if (resultsCard) {
            resultsCard.style.display = 'block';
        }
        
        // Play sound effect
        this.playSoundEffect(isCorrect ? 'correct' : 'incorrect');
        
        // Show feedback
        if (isCorrect) {
            this.showToast('✓ Correct!', 'success');
        } else {
            this.showToast('✗ Incorrect. Check the explanation.', 'error');
        }
        
        // Load ad every 3rd correct answer
        if (isCorrect && this.countCorrectAnswers() % 3 === 0) {
            setTimeout(() => this.loadAd(), 1000);
        }
        
        this.saveSessionToCache();
    }

    submitShortAnswer(questionId) {
        const question = this.questions.find(q => q.id === questionId);
        const answerInput = document.getElementById(`answer_${questionId}`);
        
        if (!question) {
            this.showError('Question not found');
            return;
        }
        
        if (!answerInput || !answerInput.value.trim()) {
            this.showError('Please write an answer first');
            return;
        }
        
        const userAnswer = answerInput.value.trim();
        
        if (!this.userAnswers.has(questionId)) {
            this.userAnswers.set(questionId, {
                answer: userAnswer,
                answered: true,
                correct: false, // Short answers are always marked as incorrect for self-review
                timestamp: Date.now(),
                checkedAt: new Date().toISOString()
            });
        } else {
            const answer = this.userAnswers.get(questionId);
            answer.answer = userAnswer;
            answer.answered = true;
            answer.timestamp = Date.now();
            answer.checkedAt = new Date().toISOString();
        }
        
        // Show answer
        this.toggleAnswer(questionId);
        
        // Update progress
        this.updateProgressIndicator();
        this.updateResultsSummary();
        
        // Show results card if not shown
        document.getElementById('resultsCard').style.display = 'block';
        
        this.showToast('✓ Answer submitted! Compare with the correct answer.', 'success');
        this.saveSessionToCache();
    }

    updateShortAnswer(questionId, value) {
        if (this.userAnswers.has(questionId)) {
            this.userAnswers.get(questionId).answer = value;
            this.saveSessionToCache();
        }
    }

    showAnswerResult(card, questionId, userAnswer) {
        const options = card.querySelectorAll('.option');
        const question = this.questions.find(q => q.id === questionId);
        
        if (question.type === 'multiple_choice' && options.length > 0) {
            options.forEach((option, index) => {
                option.classList.remove('selected');
                
                if (index === userAnswer.selected) {
                    option.classList.add(userAnswer.correct ? 'correct' : 'incorrect');
                } else if (question.options[index] === question.correct_answer) {
                    option.classList.add('correct');
                }
                
                // Disable further clicks
                option.style.pointerEvents = 'none';
            });
            
            // Disable check button
            const checkBtn = card.querySelector('.check-btn');
            if (checkBtn) {
                checkBtn.disabled = true;
                checkBtn.innerHTML = userAnswer.correct ? 
                    '<i class="fas fa-check"></i> Correct!' : 
                    '<i class="fas fa-times"></i> Incorrect';
                checkBtn.classList.add(userAnswer.correct ? 'btn-success' : 'btn-danger');
            }
        }
        
        // Enable show button
        const showBtn = card.querySelector('.show-btn');
        if (showBtn) {
            showBtn.disabled = false;
        }
    }

    toggleAnswer(questionId) {
        const answerSection = document.getElementById(`answer_section_${questionId}`);
        const toggleBtn = document.querySelector(`.question-card[data-id="${questionId}"] .show-btn`);
        
        if (!answerSection || !toggleBtn) return;
        
        if (answerSection.classList.contains('show')) {
            answerSection.classList.remove('show');
            toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show Answer';
        } else {
            answerSection.classList.add('show');
            toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Answer';
            
            // Record that user viewed the answer
            if (!this.userAnswers.has(questionId)) {
                this.userAnswers.set(questionId, {
                    viewedAnswer: true,
                    answered: false
                });
            } else {
                this.userAnswers.get(questionId).viewedAnswer = true;
            }
            
            this.saveSessionToCache();
        }
    }

    toggleAllAnswers() {
        const allAnswerSections = document.querySelectorAll('.answer-section');
        const toggleBtn = document.getElementById('toggleAllAnswers');
        
        if (allAnswerSections.length === 0) return;
        
        const allHidden = Array.from(allAnswerSections).every(section => 
            !section.classList.contains('show')
        );
        
        allAnswerSections.forEach(section => {
            if (allHidden) {
                section.classList.add('show');
            } else {
                section.classList.remove('show');
            }
        });
        
        if (toggleBtn) {
            toggleBtn.innerHTML = allHidden ? 
                '<i class="fas fa-eye-slash"></i> Hide All Answers' : 
                '<i class="fas fa-eye"></i> Show All Answers';
        }
    }

    filterByConcept(concept) {
        const questions = document.querySelectorAll('.question-card');
        questions.forEach(q => {
            if (q.dataset.concept === concept) {
                q.style.display = 'block';
                q.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                q.style.display = 'none';
            }
        });
        
        this.showToast(`Showing questions about: ${concept}`, 'info');
        
        // Add button to clear filter
        const conceptsList = document.getElementById('conceptsList');
        if (!document.getElementById('clearFilterBtn')) {
            const clearBtn = document.createElement('button');
            clearBtn.id = 'clearFilterBtn';
            clearBtn.className = 'btn btn-outline';
            clearBtn.innerHTML = '<i class="fas fa-times"></i> Clear Filter';
            clearBtn.onclick = () => {
                questions.forEach(q => q.style.display = 'block');
                clearBtn.remove();
                this.showToast('Showing all questions', 'info');
            };
            conceptsList.appendChild(clearBtn);
        }
    }

    updateProgressIndicator() {
        const answered = Array.from(this.userAnswers.values()).filter(a => a.answered).length;
        const total = this.questions.length;
        const percentage = total > 0 ? Math.round((answered / total) * 100) : 0;
        
        const progressText = document.getElementById('progressText');
        const miniProgressFill = document.getElementById('miniProgressFill');
        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');
        
        if (progressText) {
            progressText.textContent = `${answered}/${total} answered`;
        }
        if (miniProgressFill) {
            miniProgressFill.style.width = `${percentage}%`;
        }
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        if (progressPercent) {
            progressPercent.textContent = `${percentage}%`;
        }
    }

    updateResultsSummary() {
        const answered = Array.from(this.userAnswers.values()).filter(a => a.answered).length;
        const correct = Array.from(this.userAnswers.values()).filter(a => a.correct).length;
        const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        
        const totalQuestions = document.getElementById('totalQuestions');
        const answeredQuestions = document.getElementById('answeredQuestions');
        const correctAnswers = document.getElementById('correctAnswers');
        const accuracyRate = document.getElementById('accuracyRate');
        
        if (totalQuestions) totalQuestions.textContent = this.questions.length;
        if (answeredQuestions) answeredQuestions.textContent = answered;
        if (correctAnswers) correctAnswers.textContent = correct;
        if (accuracyRate) accuracyRate.textContent = `${accuracy}%`;
        
        // Update accuracy color
        if (accuracyRate) {
            accuracyRate.style.color = accuracy >= 80 ? '#4cc9f0' : 
                                      accuracy >= 60 ? '#f8961e' : 
                                      '#f72585';
        }
    }

    countCorrectAnswers() {
        return Array.from(this.userAnswers.values()).filter(a => a.correct).length;
    }

    loadAd() {
        const adBanner = document.getElementById('adBanner');
        if (!adBanner) return;
        
        const adTemplates = [
            {
                title: 'Upgrade to StudyLoop Pro',
                description: 'Unlock unlimited questions, advanced analytics, and ad-free experience!',
                cta: 'Learn More',
                color: '#4361ee'
            },
            {
                title: 'Study Smarter, Not Harder',
                description: 'Get personalized study plans with our premium features.',
                cta: 'Try Free Trial',
                color: '#7209b7'
            },
            {
                title: 'Boost Your Grades',
                description: 'Join thousands of students improving with StudyLoop Premium.',
                cta: 'See Plans',
                color: '#4cc9f0'
            }
        ];
        
        const randomAd = adTemplates[Math.floor(Math.random() * adTemplates.length)];
        
        adBanner.innerHTML = `
            <div class="ad-content" style="border-left-color: ${randomAd.color}">
                <div>
                    <small>Advertisement</small>
                    <h4>${randomAd.title}</h4>
                    <p>${randomAd.description}</p>
                </div>
                <button class="btn-ad" onclick="app.handleAdClick()" style="background: ${randomAd.color}">
                    ${randomAd.cta}
                </button>
            </div>
        `;
    }

    handleAdClick() {
        // Track ad click
        console.log('Ad clicked');
        
        // Show premium modal (simplified)
        this.showPremiumModal();
    }

    showPremiumModal() {
        const modalHtml = `
            <div class="modal-overlay" id="premiumModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🎓 StudyLoop Premium</h3>
                        <button class="modal-close" onclick="app.closePremiumModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="feature-list">
                            <div class="feature">
                                <i class="fas fa-infinity"></i>
                                <div>
                                    <h4>Unlimited Questions</h4>
                                    <p>Generate as many questions as you need</p>
                                </div>
                            </div>
                            <div class="feature">
                                <i class="fas fa-chart-line"></i>
                                <div>
                                    <h4>Advanced Analytics</h4>
                                    <p>Track progress with detailed insights</p>
                                </div>
                            </div>
                            <div class="feature">
                                <i class="fas fa-ad"></i>
                                <div>
                                    <h4>Ad-Free Experience</h4>
                                    <p>Study without interruptions</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="pricing">
                            <div class="price-card">
                                <h4>Monthly</h4>
                                <div class="price">$4.99<span>/month</span></div>
                                <button class="btn btn-primary">Get Started</button>
                            </div>
                            <div class="price-card popular">
                                <div class="popular-badge">Most Popular</div>
                                <h4>Yearly</h4>
                                <div class="price">$49.99<span>/year</span></div>
                                <div class="savings">Save 16%</div>
                                <button class="btn btn-primary">Get Started</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to body
        const modal = document.createElement('div');
        modal.innerHTML = modalHtml;
        document.body.appendChild(modal);
        
        // Add modal styles
        if (!document.querySelector('#modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'modal-styles';
            styles.textContent = `
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: white;
                    border-radius: 12px;
                    max-width: 500px;
                    width: 90%;
                    max-height: 80vh;
                    overflow-y: auto;
                }
                .modal-header {
                    padding: 1.5rem;
                    border-bottom: 1px solid #e9ecef;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-close {
                    background: none;
                    border: none;
                    font-size: 1.5rem;
                    cursor: pointer;
                }
                .modal-body {
                    padding: 1.5rem;
                }
            `;
            document.head.appendChild(styles);
        }
    }

    closePremiumModal() {
        const modal = document.getElementById('premiumModal');
        if (modal) {
            modal.remove();
        }
    }

    saveSessionToCache() {
        const sessionData = {
            currentSession: this.currentSession,
            questions: this.questions,
            concepts: this.concepts,
            userAnswers: Array.from(this.userAnswers.entries()),
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem('studyloop_session', JSON.stringify(sessionData));
            localStorage.setItem('studyloop_session_time', Date.now().toString());
        } catch (e) {
            console.warn('Failed to save session to localStorage:', e);
        }
    }

    checkForCachedSession() {
        try {
            const cachedTime = localStorage.getItem('studyloop_session_time');
            if (!cachedTime) return;
            
            const hoursSince = (Date.now() - parseInt(cachedTime)) / (1000 * 60 * 60);
            if (hoursSince > 24) {
                // Clear old session
                localStorage.removeItem('studyloop_session');
                localStorage.removeItem('studyloop_session_time');
                return;
            }
            
            const cached = localStorage.getItem('studyloop_session');
            if (cached) {
                const sessionData = JSON.parse(cached);
                this.currentSession = sessionData.currentSession;
                this.questions = sessionData.questions || [];
                this.concepts = sessionData.concepts || [];
                this.userAnswers = new Map(sessionData.userAnswers || []);
                
                // Show restore option
                this.showRestoreOption();
            }
        } catch (e) {
            console.warn('Failed to restore session:', e);
        }
    }

    showRestoreOption() {
        if (this.questions.length === 0) return;
        
        const uploadSection = document.getElementById('uploadSection');
        if (!uploadSection) return;
        
        // Remove existing restore banner
        const existing = document.querySelector('.restore-session');
        if (existing) existing.remove();
        
        const answered = Array.from(this.userAnswers.values()).filter(a => a.answered).length;
        const total = this.questions.length;
        
        const restoreHtml = `
            <div class="restore-session">
                <div class="restore-content">
                    <i class="fas fa-history"></i>
                    <div>
                        <h4>Continue Previous Session?</h4>
                        <p>You have ${answered}/${total} questions answered</p>
                    </div>
                </div>
                <div class="restore-actions">
                    <button class="btn btn-primary" onclick="app.restoreSession()">
                        <i class="fas fa-play"></i> Continue
                    </button>
                    <button class="btn btn-outline" onclick="this.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i> Dismiss
                    </button>
                </div>
            </div>
        `;
        
        uploadSection.insertAdjacentHTML('afterbegin', restoreHtml);
    }

    restoreSession() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('questionsSection').style.display = 'block';
        this.displayQuestions();
        this.loadAd();
        this.showToast('Session restored!', 'success');
    }

    startNewSession() {
        if (confirm('Start a new session? Current progress will be saved locally.')) {
            document.getElementById('questionsSection').style.display = 'none';
            document.getElementById('uploadSection').style.display = 'block';
            
            // Clear current data but keep cache
            this.questions = [];
            this.concepts = [];
            this.userAnswers.clear();
            this.currentSession = null;
            
            // Reset UI
            const questionsContainer = document.getElementById('questionsContainer');
            const conceptsList = document.getElementById('conceptsList');
            if (questionsContainer) questionsContainer.innerHTML = '';
            if (conceptsList) conceptsList.innerHTML = '';
            
            const resultsCard = document.getElementById('resultsCard');
            if (resultsCard) resultsCard.style.display = 'none';
            
            this.showToast('New session started!', 'success');
        }
    }

    async generateMoreQuestions() {
        if (!this.currentSession || !this.currentSession.id) {
            this.showError('No active session found.');
            return;
        }
        
        if (this.isGenerating) {
            this.showError('Please wait for current generation to complete');
            return;
        }
        
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        const originalText = loadMoreBtn.innerHTML;
        
        try {
            this.isGenerating = true;
            loadMoreBtn.disabled = true;
            loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
            
            this.showStatus('Generating more questions...');
            
            const response = await fetch(`${this.apiEndpoint}/api/generate-more`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: this.currentSession.id,
                    concepts: this.concepts,
                    existing_questions: JSON.stringify(this.questions.slice(0, 3))
                }),
                timeout: 30000
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.questions && data.questions.length > 0) {
                    // Add new questions
                    this.questions = [...this.questions, ...data.questions];
                    this.displayQuestions();
                    this.showSuccess(`Added ${data.questions.length} new questions!`);
                    
                    // Scroll to new questions
                    const newQuestions = document.querySelectorAll('.question-card');
                    if (newQuestions.length > 0) {
                        newQuestions[newQuestions.length - 1].scrollIntoView({ behavior: 'smooth' });
                    }
                } else {
                    this.showToast('No additional questions generated', 'info');
                }
            } else {
                throw new Error('Failed to generate more questions');
            }
        } catch (error) {
            console.error('Failed to generate more questions:', error);
            
            // Add mock questions as fallback
            const mockQuestions = this.generateMockQuestions('', `mock_${Date.now()}`).questions;
            this.questions = [...this.questions, ...mockQuestions];
            this.displayQuestions();
            this.showToast('Added 3 sample questions (demo mode)', 'info');
            
        } finally {
            this.isGenerating = false;
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = originalText;
            this.hideStatus();
        }
    }

    showSessionInfo() {
        // Add session info to concepts panel
        const conceptsPanel = document.querySelector('.concepts-panel');
        if (!conceptsPanel || !this.currentSession) return;
        
        let sessionInfo = document.getElementById('sessionInfo');
        if (!sessionInfo) {
            sessionInfo = document.createElement('div');
            sessionInfo.id = 'sessionInfo';
            sessionInfo.className = 'session-info';
            conceptsPanel.appendChild(sessionInfo);
        }
        
        const date = new Date(this.currentSession.generated_at).toLocaleDateString();
        const time = new Date(this.currentSession.generated_at).toLocaleTimeString();
        const isMock = this.currentSession.is_mock ? ' (Demo Mode)' : '';
        
        sessionInfo.innerHTML = `
            <small>
                <i class="fas fa-calendar"></i> Generated: ${date} at ${time}
                ${isMock ? '<span class="demo-badge">Demo</span>' : ''}
            </small>
        `;
    }

    reviewIncorrectAnswers() {
        const incorrectIds = Array.from(this.userAnswers.entries())
            .filter(([id, answer]) => answer.answered && !answer.correct)
            .map(([id]) => id);
        
        if (incorrectIds.length === 0) {
            this.showError('No incorrect answers to review!');
            return;
        }
        
        // Filter questions to show only incorrect ones
        const reviewQuestions = this.questions.filter(q => incorrectIds.includes(q.id));
        
        // Create a review session
        const originalQuestions = this.questions;
        const originalSession = this.currentSession;
        
        this.questions = reviewQuestions;
        this.currentSession = {
            ...originalSession,
            is_review: true,
            original_question_count: originalQuestions.length,
            incorrect_count: incorrectIds.length
        };
        
        this.displayQuestions();
        
        // Add back button
        const conceptsPanel = document.querySelector('.concepts-panel');
        if (conceptsPanel && !document.getElementById('backToAllBtn')) {
            const backBtn = document.createElement('button');
            backBtn.id = 'backToAllBtn';
            backBtn.className = 'btn btn-outline';
            backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back to All Questions';
            backBtn.onclick = () => {
                this.questions = originalQuestions;
                this.currentSession = originalSession;
                this.displayQuestions();
                backBtn.remove();
            };
            conceptsPanel.appendChild(backBtn);
        }
        
        this.showSuccess(`Reviewing ${incorrectIds.length} incorrect answer(s)`);
    }

    shareResults() {
        const answered = Array.from(this.userAnswers.values()).filter(a => a.answered).length;
        const correct = Array.from(this.userAnswers.values()).filter(a => a.correct).length;
        const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        
        const shareText = `I just completed a StudyLoop session! 📚\n` +
                         `Answered: ${answered}/${this.questions.length} questions\n` +
                         `Accuracy: ${accuracy}%\n` +
                         `Try StudyLoop for yourself: ${window.location.href}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'My StudyLoop Results',
                text: shareText,
                url: window.location.href
            }).catch(err => {
                console.log('Share cancelled:', err);
                this.copyToClipboard(shareText);
            });
        } else {
            this.copyToClipboard(shareText);
        }
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Results copied to clipboard!', 'success');
        } catch (err) {
            console.error('Clipboard error:', err);
            
            // Fallback method
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.showToast('Results copied to clipboard!', 'success');
            } catch (err2) {
                this.showError('Failed to copy results. Please copy manually.');
            }
            document.body.removeChild(textArea);
        }
    }

    async calculateFileHash(content) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(content);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return `hash_${content.length}_${Date.now()}`;
        }
    }

    exportSession() {
        const exportData = {
            session: this.currentSession,
            questions: this.questions,
            userAnswers: Array.from(this.userAnswers.entries()),
            summary: {
                total: this.questions.length,
                answered: Array.from(this.userAnswers.values()).filter(a => a.answered).length,
                correct: Array.from(this.userAnswers.values()).filter(a => a.correct).length,
                accuracy: this.countCorrectAnswers() / this.questions.length * 100
            },
            exported_at: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `studyloop_session_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showToast('Session exported!', 'success');
    }

    updateProgress(percent, message) {
        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');
        
        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
        if (progressPercent) {
            progressPercent.textContent = `${percent}%`;
        }
        
        // Update step in progress bar
        const steps = document.querySelectorAll('.step');
        if (steps.length >= 3) {
            if (percent < 30) {
                steps[0].classList.add('active');
                steps[1].classList.remove('active');
                steps[2].classList.remove('active');
            } else if (percent < 70) {
                steps[0].classList.remove('active');
                steps[1].classList.add('active');
                steps[2].classList.remove('active');
            } else {
                steps[0].classList.remove('active');
                steps[1].classList.remove('active');
                steps[2].classList.add('active');
            }
        }
    }

    showUploadProgress() {
        const progressContainer = document.getElementById('progressContainer');
        const uploadCard = document.querySelector('.upload-card');
        
        if (progressContainer && uploadCard) {
            uploadCard.style.display = 'none';
            progressContainer.style.display = 'block';
        }
    }

    hideUploadProgress() {
        const progressContainer = document.getElementById('progressContainer');
        const uploadCard = document.querySelector('.upload-card');
        
        if (progressContainer && uploadCard) {
            progressContainer.style.display = 'none';
            uploadCard.style.display = 'block';
        }
    }

    showStatus(message) {
        let status = document.getElementById('statusMessage');
        if (!status) {
            status = document.createElement('div');
            status.id = 'statusMessage';
            status.className = 'status-message';
            document.body.appendChild(status);
        }
        status.textContent = message;
        status.style.display = 'block';
    }

    hideStatus() {
        const status = document.getElementById('statusMessage');
        if (status) {
            status.style.display = 'none';
        }
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showToast(message, type = 'info') {
        // Remove existing toasts
        const existing = document.querySelectorAll('.toast');
        existing.forEach(t => t.remove());
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                <span>${message}</span>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        
        document.body.appendChild(toast);
        
        // Show toast
        setTimeout(() => toast.classList.add('show'), 10);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }

    playSoundEffect(type) {
        // Create audio context for sound effects
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (type === 'correct') {
                // Positive chime
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                
                gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.5);
            } else if (type === 'incorrect') {
                // Negative tone
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 400;
                oscillator.type = 'sawtooth';
                
                gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.05, audioContext.currentTime + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.3);
            }
        } catch (e) {
            // Audio not supported, silently fail
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new StudyLoop();
    console.log('StudyLoop initialized');
    
    // Add CSS for additional components
    const additionalStyles = `
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: white;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-width: 300px;
            max-width: 400px;
            z-index: 1000;
            transform: translateY(100px);
            opacity: 0;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }
        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }
        .toast-success {
            border-left: 4px solid #4cc9f0;
        }
        .toast-error {
            border-left: 4px solid #f72585;
        }
        .toast-info {
            border-left: 4px solid #4361ee;
        }
        .toast-content {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .toast-close {
            background: none;
            border: none;
            font-size: 1.2rem;
            cursor: pointer;
            color: #666;
        }
        .status-message {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #4361ee;
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .restore-session {
            background: rgba(67, 97, 238, 0.1);
            border: 2px solid #4361ee;
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        .restore-content {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .restore-actions {
            display: flex;
            gap: 0.5rem;
        }
        .demo-badge {
            background: #f8961e;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            margin-left: 5px;
        }
        .session-info {
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #e9ecef;
        }
        .correct-icon { color: #4cc9f0; }
        .incorrect-icon { color: #f72585; }
        .difficulty-badge {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 600;
            margin-left: 8px;
        }
        .difficulty-badge.easy { background: rgba(76, 201, 240, 0.2); color: #4cc9f0; }
        .difficulty-badge.medium { background: rgba(248, 150, 30, 0.2); color: #f8961e; }
        .difficulty-badge.hard { background: rgba(247, 37, 133, 0.2); color: #f72585; }
        .btn-success { background: #4cc9f0 !important; }
        .btn-danger { background: #f72585 !important; }
        .correct-check { color: #4cc9f0; margin-left: 10px; }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = additionalStyles;
    document.head.appendChild(styleSheet);
});