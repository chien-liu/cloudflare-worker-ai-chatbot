# Chien's Publications: Deep Learning, Reinforcement Learning, and Computer Vision

## Paper 1: Dynamic Attention-Based Visual Odometry
- **Title:** Dynamic attention-based visual odometry (DAVO)
- **Url:** https://openaccess.thecvf.com/content_CVPRW_2020/papers/w3/Kuo_Dynamic_Attention-Based_Visual_Odometry_CVPRW_2020_paper.pdf
- **Published Conference:** Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR) Workshops, 2020
- **Authors:** Xin-Yu Kuo, Chien Liu, Kai-Chen Lin, Chun-Yi Lee
- **Abstract:** This paper proposes a dynamic attention-based visual odometry framework (DAVO), a learning-based visual odometry (VO) method, for estimating the ego-motion of a monocular camera. DAVO dynamically adjusts the attention weights on different semantic categories for different motion scenarios based on optical flow maps. These weighted semantic categories can then be used to generate attention maps that highlight the relative importance of different semantic regions in input frames for pose estimation. In order to examine the proposed DAVO, we perform a number of experiments on the KITTI Visual Odometry and SLAM benchmark suite to quantitatively and qualitatively inspect the impacts of the dynamically adjusted weights on the accuracy of the evaluated trajectories. Moreover, we design a set of ablation analyses to justify each of our design choices, and validate the effectiveness as well as the advantages of DAVO. Our experiments on the KITTI dataset shows that the proposed DAVO framework does provide satisfactory performance in ego-motion estimation, and is able deliver competitive performance when compared to the contemporary VO methods.

---

## Paper 2: Toward Synergism in Macro Action Ensembles
- **Title:** Toward Synergism in Macro Action Ensembles
- **Url:** https://www.automl.org/wp-content/uploads/2020/07/AutoML_2020_paper_41.pdf
- **Published Conference:** 7th ICML Workshop on Automated Machine Learning (AutoML 2020)
- **Authors:** Yu Ming Chen, Kuan-Yu Chang, Chien Liu, Tsu-Ching Hsiao, Zhang-Wei Hong, Chun-Yi Lee
- **Abstract:** Macro actions have been demonstrated to be beneficial for the learning processes of an agent. A variety of techniques have been developed to construct more effective macro actions. However, they usually fail to provide an approach for combining macro actions to form a synergistic macro action ensemble. A synergistic macro action ensemble performs better than individual macro actions within it. Motivated by the recent advances of neural architecture search, we formulate the construction of a synergistic macro action ensemble as a sequential decision problem and evaluate the ensemble in a task. The formulation of sequential decision problem enables coherency in the macro actions to be considered. Also, our evaluation procedure takes synergism into account since the synergism among the macro action ensemble exhibits when jointly used by an agent. The experimental results show that our framework is able to discover synergistic macro action ensembles. We further perform experiments to validate the synergism property among the macro actions in an ensemble.

---

## Paper 3: Sim-to-Real: Virtual Guidance for Robot Navigation
- **Title:** Sim-to-Real: Virtual Guidance for Robot Navigation
- **Url:** https://www.hackster.io/do-you-wanna-build-a-snowman/sim-to-real-virtual-guidance-for-robot-navigation-71e54a
- **Published Conference/Award:** Nvidia - AI at the Edge Challenge (Autonomous Machines & Robotics), 2nd Place
- **Authors:** K. Lin, E. Luo, C. Ting, H. Liu, Y. Chen, Chien Liu
- **Abstract:** This work proposes an easy-to-implement and low-cost modular framework for complex robot navigation tasks using only a single RGB camera. The system integrates four essential functionalities: visual perception, localization, navigation, and obstacle avoidance. Key techniques include semantic segmentation with Deep Neural Networks (DNNs), Simultaneous Localization and Mapping (SLAM), path planning algorithms, and Deep Reinforcement Learning (DRL). A core contribution is the "Virtual Guidance" concept, which uses intermediate virtual waypoints (rendered as visual lures, such as a yellow ball on semantic maps) to guide DRL agents. To bridge the reality gap in sim-to-real transfer, the framework uses semantic segmentation as an intermediate representation, allowing the control policy trained in Unity simulations to be seamlessly deployed in real-world indoor and outdoor environments. Experimental results demonstrate high success rates in navigating crowded environments without the need for expensive sensors like LIDAR or GPS.